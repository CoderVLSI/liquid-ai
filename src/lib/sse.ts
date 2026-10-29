// Incremental parser for the server-sent events stream of /v1/chat/completions.

export interface ChatDelta {
  content?: string;
  reasoning?: string;
  finish?: string | null;
  error?: string;
}

/**
 * Feed raw text chunks; get back parsed deltas. Keeps partial lines between calls.
 * `[DONE]` is reported as { finish: 'done' }.
 */
export class SseParser {
  private buf = '';

  push(chunk: string): ChatDelta[] {
    this.buf += chunk;
    const out: ChatDelta[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      const d = parseLine(line);
      if (d) out.push(d);
    }
    return out;
  }

  flush(): ChatDelta[] {
    const rest = this.buf;
    this.buf = '';
    if (!rest.trim()) return [];
    const d = parseLine(rest.replace(/\r$/, ''));
    return d ? [d] : [];
  }
}

export function parseLine(line: string): ChatDelta | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload) return null;
  if (payload === '[DONE]') return { finish: 'done' };
  let json: any;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  if (json?.error) {
    return { error: typeof json.error === 'string' ? json.error : json.error.message ?? JSON.stringify(json.error) };
  }
  const choice = json?.choices?.[0];
  if (!choice) return null;
  const delta = choice.delta ?? {};
  const out: ChatDelta = {};
  if (typeof delta.content === 'string' && delta.content) out.content = delta.content;
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) out.reasoning = delta.reasoning_content;
  if (choice.finish_reason) out.finish = choice.finish_reason;
  return Object.keys(out).length ? out : null;
}
