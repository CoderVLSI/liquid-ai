import type { Note, Tool } from './types.ts';
import { evaluate, formatNumber } from './calc.ts';
import { formatHits, htmlToText, parseDuckDuckGo } from './html.ts';

export interface FetchResult {
  status: number;
  text: string;
  contentType: string;
}

export interface ToolDeps {
  now: () => Date;
  /** GET/POST with a timeout and a size cap, supplied by the host */
  fetchText: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResult>;
  notes: { add(text: string): Note; list(): Note[]; remove(id: string): boolean };
  /** schedules a notification and returns an id */
  scheduleReminder: (atMs: number, text: string) => Promise<number> | number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function formatDateTime(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getDay()]} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (local time)`;
}

export function buildTools(deps: ToolDeps): Tool[] {
  return [
    {
      name: 'get_time',
      description: 'Get the current local date and time.',
      parameters: { type: 'object', properties: {} },
      async run() {
        return formatDateTime(deps.now());
      },
    },
    {
      name: 'calculator',
      description: 'Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, sqrt, sin, cos, ln, log, abs, round, min, max, pi, e.',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'e.g. "(12.5 * 4) / 3"' } },
        required: ['expression'],
      },
      async run(args) {
        const expr = str(args.expression);
        if (!expr) return 'Error: no expression given.';
        try {
          return `${expr} = ${formatNumber(evaluate(expr))}`;
        } catch (e: any) {
          return `Error: ${e?.message ?? e}`;
        }
      },
    },
    {
      name: 'save_note',
      description: 'Save a note to the user\'s notebook so it can be found later.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      async run(args) {
        const text = str(args.text);
        if (!text) return 'Error: the note is empty.';
        const n = deps.notes.add(text);
        return `Saved note ${n.id}.`;
      },
    },
    {
      name: 'list_notes',
      description: 'List saved notes, optionally filtered by a search word.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'optional word to search for' } } },
      async run(args) {
        const q = str(args.query).toLowerCase();
        const all = deps.notes.list().filter((n) => !q || n.text.toLowerCase().includes(q));
        if (!all.length) return q ? `No notes match "${q}".` : 'The notebook is empty.';
        return all
          .slice(-25)
          .map((n) => `[${n.id}] ${new Date(n.t).toISOString().slice(0, 16).replace('T', ' ')}  ${n.text}`)
          .join('\n');
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a note by its id (from list_notes).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args) {
        return deps.notes.remove(str(args.id)) ? 'Deleted.' : 'No note with that id.';
      },
    },
    {
      name: 'set_reminder',
      description:
        'Show a notification to the user later. Give either "minutes" from now, or "at" as a local date-time like 2026-10-30T09:00.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what to remind about' },
          minutes: { type: 'number', description: 'minutes from now' },
          at: { type: 'string', description: 'local ISO date-time' },
        },
        required: ['text'],
      },
      async run(args) {
        const text = str(args.text);
        if (!text) return 'Error: say what to remind about.';
        const now = deps.now().getTime();
        let at: number | null = null;
        const minutes = num(args.minutes);
        if (minutes != null && minutes > 0) at = now + minutes * 60_000;
        else if (str(args.at)) {
          const t = Date.parse(str(args.at));
          if (Number.isFinite(t)) at = t;
        }
        if (at == null) return 'Error: give "minutes" (a positive number) or "at" (a date-time).';
        if (at <= now + 5_000) return 'Error: that time is in the past.';
        await deps.scheduleReminder(at, text);
        return `Reminder set for ${formatDateTime(new Date(at))}: ${text}`;
      },
    },
    {
      name: 'web_search',
      description: 'Search the web. Returns titles, links and snippets. Follow up with fetch_url to read a page.',
      web: true,
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      async run(args) {
        const q = str(args.query);
        if (!q) return 'Error: empty query.';
        try {
          const r = await deps.fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Android 14; Mobile) LFM3Pocket' },
          });
          const hits = parseDuckDuckGo(r.text);
          if (hits.length) return formatHits(hits);
        } catch {
          // fall through to Wikipedia
        }
        try {
          const r = await deps.fetchText(
            `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=6&format=json&srsearch=${encodeURIComponent(q)}`,
          );
          const j = JSON.parse(r.text);
          const hits = (j?.query?.search ?? []).map((h: any) => ({
            title: String(h.title),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
            snippet: htmlToText(String(h.snippet ?? ''), 300),
          }));
          return formatHits(hits);
        } catch (e: any) {
          return `Search failed: ${e?.message ?? e}`;
        }
      },
    },
    {
      name: 'fetch_url',
      description: 'Download a web page and return its readable text (first ~6000 characters).',
      web: true,
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      async run(args) {
        const url = str(args.url);
        if (!/^https?:\/\//i.test(url)) return 'Error: the url must start with http:// or https://';
        try {
          const r = await deps.fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Android 14; Mobile) LFM3Pocket' } });
          if (r.status >= 400) return `Error: HTTP ${r.status}`;
          const text = /html|xml/i.test(r.contentType) || /^\s*</.test(r.text) ? htmlToText(r.text) : r.text.slice(0, 6000);
          return text || '(the page has no readable text)';
        } catch (e: any) {
          return `Error fetching the page: ${e?.message ?? e}`;
        }
      },
    },
  ];
}
