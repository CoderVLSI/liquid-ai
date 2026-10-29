// Client for llama.cpp's OpenAI-style realtime WebSocket (`/v1/realtime`).
// Event names/fields follow tools/server/server-realtime.cpp of llama.cpp b11960.

export interface RtEvent {
  type: string;
  [key: string]: any;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onerror: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SessionInfo {
  /** Hz of the PCM16 mono audio the model expects from us */
  inputRate: number;
  /** Hz of the audio it sends back; null if this model cannot speak */
  outputRate: number | null;
}

export interface RealtimeLike {
  onEvent: (e: RtEvent) => void;
  onClose: (reason: string) => void;
  connect(): Promise<SessionInfo>;
  sessionUpdate(session: Record<string, unknown>): void;
  appendAudio(base64Pcm: string): void;
  commit(): void;
  createResponse(response?: Record<string, unknown>): void;
  cancel(): void;
  close(): void;
}

const OPEN = 1;

export class RealtimeClient implements RealtimeLike {
  onEvent: (e: RtEvent) => void = () => {};
  onClose: (reason: string) => void = () => {};

  private ws: WebSocketLike | null = null;
  private url: string;
  private factory: (url: string) => WebSocketLike;
  private closed = false;

  constructor(url: string, factory?: (url: string) => WebSocketLike) {
    this.url = url;
    this.factory = factory ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
  }

  connect(timeoutMs = 15000): Promise<SessionInfo> {
    return new Promise<SessionInfo>((resolve, reject) => {
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
        reject(new Error(msg));
      };
      const timer = setTimeout(() => fail(`realtime connect timed out after ${timeoutMs} ms (${this.url})`), timeoutMs);

      let ws: WebSocketLike;
      try {
        ws = this.factory(this.url);
      } catch (e: any) {
        fail(`could not open WebSocket: ${e?.message ?? e}`);
        return;
      }
      this.ws = ws;

      ws.onerror = (ev: any) => fail(`WebSocket error: ${ev?.message ?? 'connection failed'} (${this.url})`);
      ws.onclose = (ev: any) => {
        const reason = `closed (${ev?.code ?? '?'}${ev?.reason ? ' ' + ev.reason : ''})`;
        if (!settled) return fail(`WebSocket ${reason} before session was created`);
        if (!this.closed) this.onClose(reason);
      };
      ws.onmessage = (ev) => {
        let e: RtEvent;
        try {
          e = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (!settled && e.type === 'session.created') {
          settled = true;
          clearTimeout(timer);
          const audio = e.session?.audio ?? {};
          resolve({
            inputRate: Number(audio.input?.format?.rate) || 16000,
            outputRate: audio.output?.format?.rate ? Number(audio.output.format.rate) : null,
          });
        }
        this.onEvent(e);
      };
    });
  }

  private send(obj: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  sessionUpdate(session: Record<string, unknown>) {
    this.send({ type: 'session.update', session });
  }

  appendAudio(base64Pcm: string) {
    this.send({ type: 'input_audio_buffer.append', audio: base64Pcm });
  }

  commit() {
    this.send({ type: 'input_audio_buffer.commit' });
  }

  createResponse(response?: Record<string, unknown>) {
    this.send(response ? { type: 'response.create', response } : { type: 'response.create' });
  }

  cancel() {
    this.send({ type: 'response.cancel' });
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      // ignore
    }
    this.ws = null;
  }
}
