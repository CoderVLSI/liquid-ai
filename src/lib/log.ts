// In-memory ring buffer of app logs, mirrored to a file by a pluggable sink.
// Pure TypeScript so it can be unit tested; the app installs the file sink at startup.

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  t: number;
  level: Level;
  tag: string;
  msg: string;
}

const MAX_ENTRIES = 3000;
let seq = 0;
let entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let sink: ((line: string) => void) | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((l) => l());
  }, 100);
}

export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return `${ts} ${e.level[0].toUpperCase()} [${e.tag}] ${e.msg}`;
}

function add(level: Level, tag: string, msg: string) {
  const e: LogEntry = { id: ++seq, t: Date.now(), level, tag, msg };
  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  try {
    sink?.(formatEntry(e) + '\n');
  } catch {
    // logging must never throw
  }
  notifySoon();
}

export function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? '\n' + v.stack : ''}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (tag: string, ...m: unknown[]) => add('debug', tag, m.map(stringify).join(' ')),
  info: (tag: string, ...m: unknown[]) => add('info', tag, m.map(stringify).join(' ')),
  warn: (tag: string, ...m: unknown[]) => add('warn', tag, m.map(stringify).join(' ')),
  error: (tag: string, ...m: unknown[]) => add('error', tag, m.map(stringify).join(' ')),
  entries: (): LogEntry[] => entries,
  clear: () => {
    entries = [];
    notifySoon();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  setSink: (s: ((line: string) => void) | null) => {
    sink = s;
  },
  dump: (max = 800): string => entries.slice(-max).map(formatEntry).join('\n'),
};
