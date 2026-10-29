import type { RealtimeLike, RtEvent } from '../net/RealtimeClient.ts';
import type { Settings } from '../state/settings.ts';
import { Vad, vadFromSensitivity } from './vad.ts';

export type VoiceState = 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'ended' | 'error';

/** The slice of the native audio module the session needs (so it can be faked in tests). */
export interface AudioPort {
  enterVoiceMode(callMode: boolean): Promise<unknown>;
  leaveVoiceMode(): Promise<unknown>;
  startMic(rate: number, voiceComm: boolean): Promise<{ sampleRate: number; aec: boolean; ns: boolean }>;
  stopMic(): Promise<unknown>;
  startPlayer(rate: number, callMode: boolean): Promise<unknown>;
  stopPlayer(): Promise<unknown>;
  playPcm(base64: string): void;
  flushPlayer(): void;
  playerPendingMs(): number;
  onMicFrame(cb: (f: { data: string; rms: number }) => void): () => void;
  onMicError(cb: (message: string) => void): () => void;
}

export interface VoiceCallbacks {
  onState(state: VoiceState): void;
  onLevel(rms: number): void;
  /** the user finished a spoken turn that lasted `ms` */
  onUserTurn(ms: number): void;
  onResponseStart(id: string): void;
  onAssistantText(delta: string, id: string): void;
  onResponseDone(id: string, status: string): void;
  onInterrupted(): void;
  onError(message: string): void;
  log(message: string): void;
}

const PRE_ROLL_FRAMES = 10; // 400 ms kept so the first syllable is not clipped
const SPEAKING_TAIL_MS = 30;

export class VoiceSession {
  state: VoiceState = 'connecting';
  muted = false;

  private client: RealtimeLike;
  private audio: AudioPort;
  private settings: Settings;
  private cb: VoiceCallbacks;
  private vad: Vad;

  private pre: string[] = [];
  private unsubs: (() => void)[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private callMode = false;

  private responseActive = false;
  private activeResponseId = '';
  private sentResponses = 0;
  private seenResponses = 0;
  private cancelUpTo = 0;
  private cancelled = new Set<string>();

  constructor(client: RealtimeLike, audio: AudioPort, settings: Settings, cb: VoiceCallbacks) {
    this.client = client;
    this.audio = audio;
    this.settings = settings;
    this.cb = cb;
    this.vad = new Vad(vadFromSensitivity(settings.vadSensitivity, settings.silenceMs));
  }

  async start(): Promise<void> {
    this.setState('connecting');
    this.client.onEvent = (e) => this.onServerEvent(e);
    this.client.onClose = (reason) => {
      if (!this.stopped) {
        this.cb.onError(`Voice connection lost: ${reason}`);
        void this.stop('error');
      }
    };

    try {
      const info = await this.client.connect();
      this.cb.log(`session created: in=${info.inputRate}Hz out=${info.outputRate ?? 'none'}Hz`);

      const speak = info.outputRate != null;
      const modalities = !speak ? ['text'] : this.settings.speechReply === 'audio' ? ['audio'] : ['text', 'audio'];
      this.client.sessionUpdate({
        instructions: this.settings.voicePrompt,
        output_modalities: modalities,
      });

      this.callMode = this.settings.callMode;
      const route = await this.audio.enterVoiceMode(this.callMode);
      this.cb.log(`audio route: ${JSON.stringify(route)}`);
      if (speak) await this.audio.startPlayer(info.outputRate as number, this.callMode);
      this.unsubs.push(this.audio.onMicFrame((f) => this.onFrame(f)));
      this.unsubs.push(this.audio.onMicError((m) => this.fail(`Microphone error: ${m}`)));
      const mic = await this.audio.startMic(info.inputRate, this.callMode);
      this.cb.log(`mic: ${JSON.stringify(mic)}`);

      this.ticker = setInterval(() => this.tick(), 100);
      this.setState('listening');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.cb.onError(msg);
      await this.stop('error');
      throw e;
    }
  }

  async stop(final: VoiceState = 'ended'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    try {
      this.client.close();
    } catch {
      // ignore
    }
    for (const step of [
      () => this.audio.stopMic(),
      () => this.audio.stopPlayer(),
      () => this.audio.leaveVoiceMode(),
    ]) {
      try {
        await step();
      } catch (e: any) {
        this.cb.log(`stop step failed: ${e?.message ?? e}`);
      }
    }
    this.setState(final);
  }

  mute(on: boolean) {
    this.muted = on;
    if (on) {
      this.vad.reset();
      this.pre = [];
      if (this.state === 'hearing') this.setState('listening');
    }
  }

  /** Tap-to-interrupt from the UI. */
  interrupt() {
    this.cancelResponse();
  }

  assistantBusy(): boolean {
    return this.responseActive || this.audio.playerPendingMs() > SPEAKING_TAIL_MS;
  }

  // ---- microphone ------------------------------------------------------------------------------

  /** Exposed for tests; called for every 40 ms mic frame. */
  onFrame(f: { data: string; rms: number }) {
    if (this.stopped) return;
    this.cb.onLevel(f.rms);
    if (this.muted) return;

    const busy = this.assistantBusy();
    if (busy && !this.settings.bargeIn) {
      // half-duplex: ignore the mic while the assistant talks so it cannot hear itself
      this.vad.reset();
      this.pre = [];
      return;
    }

    const wasSpeaking = this.vad.speaking;
    const ev = this.vad.push(f.rms, busy);

    if (ev === 'speechStart') {
      if (busy) this.cancelResponse();
      this.pre.push(f.data);
      for (const p of this.pre) this.client.appendAudio(p);
      this.pre = [];
      this.setState('hearing');
    } else if (this.vad.speaking) {
      this.client.appendAudio(f.data);
    } else if (wasSpeaking && (ev === 'speechEnd' || ev === 'speechAbort')) {
      this.client.appendAudio(f.data);
      if (ev === 'speechEnd') {
        this.cb.onUserTurn(this.vad.lastSpeechMs);
        this.respond();
      } else {
        this.setState('listening');
      }
    } else {
      this.pre.push(f.data);
      if (this.pre.length > PRE_ROLL_FRAMES) this.pre.shift();
    }
  }

  private respond() {
    this.sentResponses++;
    this.responseActive = true;
    this.client.createResponse();
    this.setState('thinking');
  }

  private cancelResponse() {
    if (this.responseActive) {
      this.client.cancel();
      // responses we asked for but the server has not announced yet are cancelled by count...
      this.cancelUpTo = this.sentResponses;
      // ...and one that is already streaming is cancelled by id, so its in-flight audio is dropped
      if (this.activeResponseId) this.cancelled.add(this.activeResponseId);
    }
    this.activeResponseId = '';
    this.audio.flushPlayer();
    this.responseActive = false;
    this.cb.onInterrupted();
  }

  /** Exposed for tests; runs every 100 ms. */
  tick() {
    if (this.stopped) return;
    if ((this.state === 'speaking' || this.state === 'thinking') && !this.assistantBusy() && !this.vad.speaking) {
      this.setState('listening');
    }
  }

  // ---- server events ---------------------------------------------------------------------------

  private onServerEvent(e: RtEvent) {
    switch (e.type) {
      case 'response.created': {
        const id = String(e.response?.id ?? '');
        this.seenResponses++;
        if (this.seenResponses <= this.cancelUpTo) {
          this.cancelled.add(id);
          return;
        }
        this.responseActive = true;
        this.activeResponseId = id;
        this.cb.onResponseStart(id);
        return;
      }
      case 'response.output_text.delta': {
        const id = String(e.response_id ?? '');
        if (this.cancelled.has(id)) return;
        this.cb.onAssistantText(String(e.delta ?? ''), id);
        return;
      }
      case 'response.output_audio.delta': {
        const id = String(e.response_id ?? '');
        if (this.cancelled.has(id) || typeof e.delta !== 'string') return;
        this.audio.playPcm(e.delta);
        if (this.state !== 'hearing') this.setState('speaking');
        return;
      }
      case 'response.done': {
        const id = String(e.response?.id ?? '');
        const status = String(e.response?.status ?? 'completed');
        if (this.cancelled.has(id)) {
          this.cancelled.delete(id);
          return;
        }
        this.responseActive = false;
        this.activeResponseId = '';
        this.cb.onResponseDone(id, status);
        return;
      }
      case 'error': {
        const msg = String(e.error?.message ?? 'unknown realtime error');
        this.cb.log(`server error: ${msg}`);
        // an empty-buffer commit is harmless noise; anything else (e.g. "model does not support
        // realtime") must reach the user instead of showing up later as a vague disconnect
        if (!/buffer is empty|commit audio or create a message first/i.test(msg)) this.cb.onError(msg);
        return;
      }
      default:
        return;
    }
  }

  private fail(message: string) {
    this.cb.onError(message);
    void this.stop('error');
  }

  private setState(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState(s);
  }
}
