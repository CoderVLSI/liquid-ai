import { native } from '../native';
import { log } from '../lib/log';
import { MODELS, filePath, getModel, hfUrl, totalBytes } from './catalog';
import { ensureNotificationPermission, inBackground, notifyPhone, refreshBackground, registerBackgroundSource } from '../lib/background';
import type { ModelDef, ModelId } from './catalog';

export type DownloadStatus = 'missing' | 'partial' | 'queued' | 'downloading' | 'ready' | 'error';

export interface ModelState {
  id: ModelId;
  status: DownloadStatus;
  bytesDone: number;
  bytesTotal: number;
  error?: string;
  /** bytes per second, smoothed */
  speed: number;
}

type Listener = () => void;

const MAX_ATTEMPTS = 8;
/** how many models download at the same time */
const MAX_PARALLEL = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Downloads {
  state: Record<ModelId, ModelState>;
  private listeners = new Set<Listener>();
  private modelsDir = '';
  private paused = new Set<ModelId>();
  private running = new Set<ModelId>();
  private queue: ModelId[] = [];
  private wired = false;
  private progress: Record<string, number> = {};
  private lastTick: Record<string, { t: number; b: number }> = {};

  constructor() {
    this.state = Object.fromEntries(
      MODELS.map((m) => [m.id, { id: m.id, status: 'missing', bytesDone: 0, bytesTotal: totalBytes(m), speed: 0 } as ModelState]),
    ) as Record<ModelId, ModelState>;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private patch(id: ModelId, p: Partial<ModelState>) {
    this.state = { ...this.state, [id]: { ...this.state[id], ...p } };
    this.emit();
    refreshBackground();
  }

  init() {
    this.modelsDir = `${native.info().filesDir}/models`;
    if (!this.wired) {
      this.wired = true;
      native.on('downloadProgress', (e) => this.onProgress(e.id, e.received));
      registerBackgroundSource('downloads', () => this.backgroundText());
    }
    this.refresh();
    void this.resumeInterrupted();
  }

  private wantedFile() {
    return `${native.info().filesDir}/downloads-wanted.json`;
  }

  /** Remember which models were being downloaded, so a killed app picks them up again. */
  private saveWanted() {
    const ids = [...this.running, ...this.queue];
    try {
      native.writeText(this.wantedFile(), JSON.stringify(ids), false);
    } catch {
      // best effort
    }
  }

  private async resumeInterrupted() {
    try {
      const raw = await native.readText(this.wantedFile());
      const ids = raw ? (JSON.parse(raw) as ModelId[]) : [];
      for (const id of ids) if (MODELS.some((m) => m.id === id) && this.state[id].status !== 'ready') this.start(id);
    } catch {
      // ignore
    }
  }

  private backgroundText(): string | null {
    const active = MODELS.filter((m) => ['downloading', 'queued'].includes(this.state[m.id].status));
    if (!active.length) return null;
    const done = active.reduce((a, m) => a + this.state[m.id].bytesDone, 0);
    const total = active.reduce((a, m) => a + this.state[m.id].bytesTotal, 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `Downloading ${active.length} model${active.length > 1 ? 's' : ''} · ${pct}%`;
  }

  readyIds(): ModelId[] {
    return MODELS.filter((m) => this.state[m.id].status === 'ready').map((m) => m.id);
  }

  modelsRoot(): string {
    return this.modelsDir;
  }

  /** Re-scan the disk. Files must match the catalog size exactly to count as ready. */
  refresh() {
    for (const m of MODELS) {
      if (this.running.has(m.id) || this.queue.includes(m.id)) continue;
      let done = 0;
      let complete = 0;
      let mismatch = '';
      for (const f of m.files) {
        const p = filePath(this.modelsDir, m, f);
        const size = native.fileSize(p);
        if (size === f.bytes) {
          complete++;
          done += size;
        } else if (size >= 0) {
          mismatch = `${f.name} is ${size} bytes, expected ${f.bytes}. Delete it and download again.`;
        } else {
          done += native.partialSize(p);
        }
      }
      const total = totalBytes(m);
      if (complete === m.files.length) this.patch(m.id, { status: 'ready', bytesDone: total, error: undefined, speed: 0 });
      else if (mismatch) this.patch(m.id, { status: 'error', bytesDone: done, error: mismatch, speed: 0 });
      else this.patch(m.id, { status: done > 0 ? 'partial' : 'missing', bytesDone: done, error: undefined, speed: 0 });
    }
  }

  private onProgress(id: string, received: number) {
    this.progress[id] = received;
    const modelId = id.split('/')[0] as ModelId;
    const m = MODELS.find((x) => x.id === modelId);
    if (!m) return;
    let done = 0;
    for (const f of m.files) {
      const key = `${m.id}/${f.name}`;
      if (this.progress[key] != null) done += this.progress[key];
      else if (native.fileSize(filePath(this.modelsDir, m, f)) === f.bytes) done += f.bytes;
    }
    const now = Date.now();
    const last = this.lastTick[modelId];
    let speed = this.state[modelId].speed;
    if (last && now - last.t >= 800) {
      const inst = ((done - last.b) * 1000) / (now - last.t);
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
      this.lastTick[modelId] = { t: now, b: done };
    } else if (!last) {
      this.lastTick[modelId] = { t: now, b: done };
    }
    this.patch(modelId, { bytesDone: done, speed });
  }

  /** Queue one model. Models download one at a time so each gets the full connection. */
  start(id: ModelId) {
    this.paused.delete(id);
    if (this.running.has(id) || this.queue.includes(id) || this.state[id].status === 'ready') return;
    this.patch(id, { status: 'queued', error: undefined });
    this.queue.push(id);
    void ensureNotificationPermission();
    this.saveWanted();
    this.pump();
  }

  startAll() {
    for (const m of MODELS) this.start(m.id);
  }

  pause(id: ModelId) {
    this.paused.add(id);
    this.queue = this.queue.filter((q) => q !== id);
    for (const f of getModel(id).files) native.cancelDownload(`${id}/${f.name}`);
    if (!this.running.has(id)) this.refresh();
    this.saveWanted();
  }

  async remove(id: ModelId) {
    this.pause(id);
    const m = getModel(id);
    for (const f of m.files) {
      await native.deleteFile(filePath(this.modelsDir, m, f));
      delete this.progress[`${id}/${f.name}`];
    }
    this.running.delete(id);
    this.patch(id, { status: 'missing', bytesDone: 0, error: undefined, speed: 0 });
    this.refresh();
  }

  /** Starts queued models until MAX_PARALLEL are running at once. */
  private pump() {
    while (this.running.size < MAX_PARALLEL && this.queue.length) {
      const id = this.queue.shift() as ModelId;
      this.running.add(id);
      void this.run(getModel(id))
        .catch((e) => log.error('download', `${id} crashed`, e))
        .finally(() => {
          this.running.delete(id);
          this.refresh();
          this.saveWanted();
          this.finished(id);
          this.pump();
        });
    }
  }

  /** Tell the user on their phone when a model is ready (or failed) while the app is minimised. */
  private finished(id: ModelId) {
    const st = this.state[id];
    const m = getModel(id);
    if (!inBackground()) return;
    if (st.status === 'ready') notifyPhone(6000 + MODELS.indexOf(m), 'Model ready', `${m.name} finished downloading and is ready to use.`);
    else if (st.status === 'error') notifyPhone(6000 + MODELS.indexOf(m), 'Download problem', `${m.name}: ${st.error ?? 'download failed'}`);
  }

  private async run(m: ModelDef) {
    const need = totalBytes(m) - this.state[m.id].bytesDone;
    // other downloads that are still running will also eat disk space
    const others = [...this.running].filter((r) => r !== m.id).reduce((a, r) => a + (this.state[r].bytesTotal - this.state[r].bytesDone), 0);
    const free = native.info().freeDiskBytes;
    if (free < need + others + 300e6) {
      this.patch(m.id, { status: 'error', error: `Not enough free storage: need ${Math.ceil(need / 1e6)} MB, have ${Math.floor(free / 1e6)} MB.` });
      return;
    }
    this.patch(m.id, { status: 'downloading', error: undefined, speed: 0 });
    this.lastTick[m.id] = undefined as any;

    for (const f of m.files) {
      const dest = filePath(this.modelsDir, m, f);
      if (native.fileSize(dest) === f.bytes) continue;
      const key = `${m.id}/${f.name}`;
      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
        if (this.paused.has(m.id)) {
          this.patch(m.id, { status: 'partial', speed: 0 });
          return;
        }
        try {
          log.info('download', `${key} attempt ${attempt}`);
          await native.downloadFile(key, hfUrl(m.repo, f.name), dest);
          ok = true;
        } catch (e: any) {
          if (e?.code === 'ERR_CANCELLED' || this.paused.has(m.id)) {
            this.patch(m.id, { status: 'partial', speed: 0 });
            return;
          }
          log.warn('download', `${key} failed: ${e?.message ?? e}`);
          if (attempt === MAX_ATTEMPTS) {
            this.patch(m.id, { status: 'error', error: `${f.name}: ${e?.message ?? e}`, speed: 0 });
            return;
          }
          await sleep(Math.min(2 ** attempt, 20) * 1000); // resumes from the .part file
        }
      }
      if (native.fileSize(dest) !== f.bytes) {
        this.patch(m.id, {
          status: 'error',
          error: `${f.name} finished at ${native.fileSize(dest)} bytes but ${f.bytes} were expected.`,
        });
        return;
      }
    }
    log.info('download', `${m.id} ready`);
  }
}

export const downloads = new Downloads();
