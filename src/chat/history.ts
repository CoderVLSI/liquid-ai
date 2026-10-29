export interface HistoryMsg {
  role: 'user' | 'assistant';
  text: string;
  hasImage?: boolean;
  voice?: boolean;
  error?: boolean;
  interrupted?: boolean;
}

export type ReqPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ReqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ReqPart[];
}

/**
 * Turns the on-screen conversation into a chat-completions request.
 *  - failed or empty messages are skipped
 *  - old images are not re-sent (re-encoding them is slow on a phone); a short note stays in the text
 *  - oldest turns are dropped first once the history exceeds `maxChars`
 */
export function buildRequest(
  system: string,
  history: HistoryMsg[],
  next: { text: string; imageDataUri?: string },
  maxChars = 9000,
): ReqMessage[] {
  const turns: ReqMessage[] = [];
  for (const m of history) {
    if (m.error) continue;
    let text = m.text.trim();
    if (m.voice && m.role === 'user') text = '(the user spoke a voice message)';
    if (m.hasImage) text = `[an image was attached] ${text}`.trim();
    if (!text) continue;
    turns.push({ role: m.role, content: text });
  }

  const nextContent: ReqMessage['content'] = next.imageDataUri
    ? [
        { type: 'image_url', image_url: { url: next.imageDataUri } },
        { type: 'text', text: next.text || 'Describe this image.' },
      ]
    : next.text;

  let used = (typeof nextContent === 'string' ? nextContent.length : next.text.length) + system.length;
  const kept: ReqMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const len = (turns[i].content as string).length;
    if (used + len > maxChars) break;
    used += len;
    kept.unshift(turns[i]);
  }
  // a conversation must not start with an assistant turn
  while (kept.length && kept[0].role === 'assistant') kept.shift();

  return [{ role: 'system', content: system }, ...kept, { role: 'user', content: nextContent }];
}
