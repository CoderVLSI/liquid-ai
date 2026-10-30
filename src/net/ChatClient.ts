import { SseParser } from '../lib/sse';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatRequestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface StreamOptions {
  baseUrl: string;
  messages: ChatRequestMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  onText: (delta: string) => void;
  onReasoning?: (delta: string) => void;
}

export interface StreamResult {
  text: string;
  finish: string;
}

/**
 * Streams /v1/chat/completions. Uses expo/fetch because React Native's built-in fetch
 * cannot stream a response body.
 */
export async function streamChat(o: StreamOptions): Promise<StreamResult> {
  const { fetch: streamingFetch } = require('expo/fetch') as typeof import('expo/fetch');
  const res = await streamingFetch(`${o.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model: 'local',
      messages: o.messages,
      stream: true,
      // reuse the already-processed start of the conversation: only the new message is read each turn
      cache_prompt: true,
      temperature: 0,
      max_tokens: o.maxTokens ?? 1024,
    }),
    signal: o.signal,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 600);
    } catch {
      // ignore
    }
    throw new Error(`Server returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!res.body) throw new Error('Server returned no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let text = '';
  let finish = '';

  const handle = (deltas: ReturnType<SseParser['push']>) => {
    for (const d of deltas) {
      if (d.error) throw new Error(d.error);
      if (d.content) {
        text += d.content;
        o.onText(d.content);
      }
      if (d.reasoning) o.onReasoning?.(d.reasoning);
      if (d.finish && d.finish !== 'done') finish = d.finish;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    handle(parser.push(decoder.decode(value, { stream: true })));
  }
  handle(parser.flush());
  return { text, finish: finish || 'stop' };
}
