import type { ChatMsg } from '../state/app.ts';

export interface SavedChat {
  id: string;
  title: string;
  /** when it was last active */
  t: number;
  messages: ChatMsg[];
}

export const MAX_CHATS = 50;
const MAX_MESSAGES = 200;

/** A short title from the first thing the user typed. */
export function titleFor(messages: ChatMsg[]): string {
  const typed = messages.find((m) => m.role === 'user' && !m.voice && m.text.trim());
  if (typed) {
    const t = typed.text.trim().replace(/\s+/g, ' ');
    return t.length > 46 ? `${t.slice(0, 45).trimEnd()}…` : t;
  }
  if (messages.some((m) => m.imageUri)) return 'Photo chat';
  if (messages.some((m) => m.voice)) return 'Voice chat';
  return 'New chat';
}

/** Only chats where the user actually said something are worth keeping. */
export const hasContent = (messages: ChatMsg[]) => messages.some((m) => m.role === 'user');

/** Puts the current chat at the top of the history (newest first), capped. */
export function archiveChat(chats: SavedChat[], messages: ChatMsg[], now: number, id: string): SavedChat[] {
  if (!hasContent(messages)) return chats;
  const clean = messages.slice(-MAX_MESSAGES).map((m) => ({ ...m, streaming: false }));
  const last = clean[clean.length - 1];
  const chat: SavedChat = { id, title: titleFor(clean), t: last?.t ?? now, messages: clean };
  return [chat, ...chats.filter((c) => c.id !== id)].slice(0, MAX_CHATS);
}

export function takeChat(chats: SavedChat[], id: string): { chat: SavedChat | null; rest: SavedChat[] } {
  return { chat: chats.find((c) => c.id === id) ?? null, rest: chats.filter((c) => c.id !== id) };
}

/** Reads the saved file; anything malformed is dropped instead of crashing the app. */
export function parseChats(raw: string | null): SavedChat[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({ id: c.id, title: String(c.title || 'Chat'), t: Number(c.t) || 0, messages: c.messages }))
      .slice(0, MAX_CHATS);
  } catch {
    return [];
  }
}
