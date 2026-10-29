import { native } from '../native';
import { log } from '../lib/log';
import { getModel, has } from '../models/catalog';
import type { ModelId } from '../models/catalog';
import type { Settings } from '../state/settings';
import { buildServerArgs } from './args';

export type ServerState = 'stopped' | 'starting' | 'ready' | 'error';

export interface ServerStatus {
  state: ServerState;
  modelId: ModelId | null;
  error?: string;
  loadMs?: number;
  /** what the running server reported about itself (/props) */
  modalities?: { vision?: boolean; audio?: boolean };
}

const SIGNALS: Record<number, string> = { 4: 'SIGILL (CPU instruction not supported)', 6: 'SIGABRT', 7: 'SIGBUS', 9: 'SIGKILL (usually Android out-of-memory killer)', 11: 'SIGSEGV' };

export function describeExit(code: number, signal: number): string {
  if (signal && SIGNALS[signal]) return `Model server stopped: ${SIGNALS[signal]} (exit ${code})`;
  return `Model server exited with code ${code}`;
}

type Listener = (s: ServerStatus) => void;

class ServerManager {
  status: ServerStatus = { state: 'stopped', modelId: null };
  private listeners = new Set<Listener>();
  private fingerprint = '';
  private pending: Promise<void> | null = null;
  private pendingKey = '';
  private exitWaiters: ((msg: string) => void)[] = [];
  private wired = false;

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private set(s: ServerStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  private wire() {
    if (this.wired) return;
    this.wired = true;
    native.on('serverExit', (e) => {
      const msg = describeExit(e.code, e.signal);
      log[e.expected ? 'info' : 'error']('server', msg + (e.expected ? ' (requested)' : '\n' + e.tail));
      this.exitWaiters.splice(0).forEach((w) => w(msg));
      if (!e.expected) {
        this.fingerprint = '';
        this.set({ state: 'error', modelId: this.status.modelId, error: `${msg}\n\nLast server output:\n${e.tail}` });
      }
    });
    native.on('serverLog', (e) => log.debug('server', e.line));
  }

  baseUrl(s: Settings): string {
    return `http://127.0.0.1:${s.port}`;
  }

  /** Start (or restart) the server for `modelId`; resolves when /health says it is ready. */
  ensure(modelId: ModelId, settings: Settings): Promise<void> {
    this.wire();
    const info = native.info();
    const model = getModel(modelId);
    const args = buildServerArgs(model, `${info.filesDir}/models`, settings, info.cores);
    const key = args.join(' ');

    if (this.status.state === 'ready' && this.fingerprint === key && native.isServerRunning()) return Promise.resolve();
    if (this.pending && this.pendingKey === key) return this.pending;

    this.pendingKey = key;
    this.pending = this.launch(modelId, args, key, settings).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async launch(modelId: ModelId, args: string[], key: string, settings: Settings): Promise<void> {
    if (!info().serverBinaryPresent) {
      const msg = 'The APK has no model server (libllama_server.so). Rebuild with the GitHub workflow.';
      this.set({ state: 'error', modelId, error: msg });
      throw new Error(msg);
    }
    const t0 = Date.now();
    this.set({ state: 'starting', modelId });
    this.fingerprint = '';
    log.info('server', `starting ${modelId}: ${args.join(' ')}`);
    try {
      await native.stopServer();
      await native.startServer(args);
    } catch (e: any) {
      this.set({ state: 'error', modelId, error: e?.message ?? String(e) });
      throw e;
    }

    const exited = new Promise<never>((_, reject) => {
      this.exitWaiters.push((msg) => reject(new Error(`${msg}\n\n${native.serverTail().split('\n').slice(-25).join('\n')}`)));
    });
    try {
      await Promise.race([this.waitHealthy(this.baseUrl(settings), 180_000), exited]);
    } catch (e: any) {
      this.set({ state: 'error', modelId, error: e?.message ?? String(e) });
      throw e;
    }

    const modalities = await this.fetchModalities(this.baseUrl(settings));
    const model = getModel(modelId);
    if (has(model, 'vision') && modalities && modalities.vision === false) {
      log.warn('server', 'model loaded without vision support even though it should have it (projector failed to load?)');
    }
    this.fingerprint = key;
    const loadMs = Date.now() - t0;
    log.info('server', `ready in ${loadMs} ms, modalities=${JSON.stringify(modalities)}`);
    this.set({ state: 'ready', modelId, loadMs, modalities });
  }

  private async waitHealthy(base: string, timeoutMs: number): Promise<void> {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < timeoutMs) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2000);
        const r = await fetch(`${base}/health`, { signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) return;
        last = `HTTP ${r.status}`; // 503 while the model loads
      } catch (e: any) {
        last = e?.message ?? String(e);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Model server did not become ready within ${Math.round(timeoutMs / 1000)} s (last: ${last})`);
  }

  private async fetchModalities(base: string): Promise<ServerStatus['modalities'] | undefined> {
    try {
      const r = await fetch(`${base}/props`);
      const j: any = await r.json();
      return j?.modalities;
    } catch {
      return undefined;
    }
  }

  async stop(): Promise<void> {
    this.pending = null;
    this.fingerprint = '';
    try {
      await native.stopServer();
    } finally {
      this.set({ state: 'stopped', modelId: null });
    }
  }
}

function info() {
  return native.info();
}

export const server = new ServerManager();
