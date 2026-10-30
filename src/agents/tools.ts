import type { Note, Reminder, Todo, Tool } from './types.ts';
import { evaluate, formatNumber } from './calc.ts';
import { formatHits, htmlToText, parseDuckDuckGo } from './html.ts';
import { describeIn, parseWhen, toLocalIso } from './when.ts';
import { convertUnits } from './units.ts';

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
  reminders: { list(): Reminder[]; cancel(id: number): boolean };
  todos: { add(text: string): Todo; list(): Todo[]; complete(idOrText: string): Todo | null };
}

const WEATHER: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

const UA = { 'User-Agent': 'LFM3Pocket/1.0 (on-device assistant; Android)' };

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
      finishes: true,
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
      finishes: true,
      description: 'Delete a note by its id (from list_notes).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(args) {
        return deps.notes.remove(str(args.id)) ? 'Deleted.' : 'No note with that id.';
      },
    },
    {
      name: 'set_reminder',
      finishes: true,
      description:
        'Set a reminder: shows a phone notification at the given time, even if the app is closed. Use it for "remind me", "notify me", "don\'t let me forget" and for tasks with a deadline.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'what to remind about, short and imperative, e.g. "Submit the BITS assignment"' },
          when: {
            type: 'string',
            description: 'the time in plain words, copied from the user: "in 20 minutes", "today 11:30", "tomorrow 9am", "friday 6pm", "5pm", "12"',
          },
          minutes_before: { type: 'number', description: 'optional: notify this many minutes BEFORE "when" (use 30 for a deadline)' },
        },
        required: ['text', 'when'],
      },
      async run(args) {
        const text = str(args.text);
        if (!text) return 'Error: say what to remind about (the "text" argument).';
        const now = deps.now();
        let base: Date | null = null;
        const when = str(args.when) || str(args.at);
        if (when) base = parseWhen(when, now);
        else if (num(args.minutes) != null && num(args.minutes)! > 0) base = new Date(now.getTime() + num(args.minutes)! * 60_000);
        if (!base) {
          return when
            ? `Error: I could not understand the time "${when}". Call set_reminder again with "when" like "in 20 minutes", "today 11:30" or "tomorrow 9am", or ask the user.`
            : 'Error: "when" is missing. Call ask_user to ask when to remind, or call set_reminder again with "when".';
        }
        if (base.getTime() <= now.getTime() + 5_000) {
          return `Error: ${formatDateTime(base)} has already passed (it is ${formatDateTime(now)}). Use a later time or ask the user.`;
        }
        let at = base.getTime();
        const before = num(args.minutes_before);
        if (before != null && before > 0) {
          at -= before * 60_000;
          if (at <= now.getTime() + 5_000) at = now.getTime() + 60_000; // deadline is close: remind right away
        }
        await deps.scheduleReminder(at, text);
        const extra = at !== base.getTime() ? ` (deadline ${formatDateTime(base)})` : '';
        return `Reminder set for ${formatDateTime(new Date(at))}, in ${describeIn(at - now.getTime())}: ${text}${extra}`;
      },
    },
    {
      name: 'list_reminders',
      description: 'List the upcoming reminders with their ids.',
      parameters: { type: 'object', properties: {} },
      async run() {
        const now = deps.now().getTime();
        const up = deps.reminders.list().filter((r) => r.at > now).sort((a, b) => a.at - b.at);
        if (!up.length) return 'No upcoming reminders.';
        return up.map((r) => `[${r.id}] ${formatDateTime(new Date(r.at))} - ${r.text}`).join('\n');
      },
    },
    {
      name: 'cancel_reminder',
      finishes: true,
      description: 'Cancel a reminder by its id (get the id from list_reminders).',
      parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      async run(args) {
        const id = num(args.id);
        if (id == null) return 'Error: give the reminder "id" from list_reminders.';
        return deps.reminders.cancel(id) ? `Cancelled reminder ${id}.` : `Error: there is no reminder ${id}. Call list_reminders to see the ids.`;
      },
    },
    {
      name: 'parse_time',
      description: 'Turn words like "tomorrow 3pm", "friday", "in 2 hours", "5pm" into an exact date and time, and say how far away it is. Use it before any calendar tool.',
      parameters: { type: 'object', properties: { when: { type: 'string', description: 'the time in plain words' } }, required: ['when'] },
      async run(args) {
        const w = str(args.when);
        const d = parseWhen(w, deps.now());
        if (!d) return `Error: I could not understand "${w}". Try "tomorrow 3pm" or "in 2 hours".`;
        const diff = d.getTime() - deps.now().getTime();
        return `${formatDateTime(d)}  |  ISO ${toLocalIso(d)}  |  ${diff >= 0 ? `in ${describeIn(diff)}` : `${describeIn(-diff)} ago`}`;
      },
    },
    {
      name: 'add_todo',
      finishes: true,
      description: 'Add an item to the user\'s to-do list.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'the to-do item, short' } }, required: ['text'] },
      async run(args) {
        const text = str(args.text);
        if (!text) return 'Error: the to-do item is empty.';
        const t = deps.todos.add(text);
        return `Added to your to-do list: ${t.text}`;
      },
    },
    {
      name: 'list_todos',
      description: 'Show the to-do list. Done items are hidden unless show_done is true.',
      parameters: { type: 'object', properties: { show_done: { type: 'boolean' } } },
      async run(args) {
        const all = deps.todos.list().filter((t) => args.show_done === true || !t.done);
        if (!all.length) return 'The to-do list is empty.';
        return all.map((t) => `[${t.id}] ${t.done ? '[x]' : '[ ]'} ${t.text}`).join('\n');
      },
    },
    {
      name: 'complete_todo',
      finishes: true,
      description: 'Tick off a to-do item. Give its id from list_todos, or some words from its text.',
      parameters: { type: 'object', properties: { item: { type: 'string', description: 'the id, or words from the item' } }, required: ['item'] },
      async run(args) {
        const item = str(args.item) || str(args.id) || str(args.text);
        if (!item) return 'Error: say which item to tick off.';
        const t = deps.todos.complete(item);
        return t ? `Done: ${t.text}` : `Error: no open to-do matches "${item}". Call list_todos to see them.`;
      },
    },
    {
      name: 'convert_units',
      description: 'Convert between units exactly: length, weight, volume, speed, time, temperature (e.g. 5 miles to km, 100 celsius to fahrenheit).',
      parameters: {
        type: 'object',
        properties: { value: { type: 'number' }, from: { type: 'string', description: 'e.g. miles, kg, celsius' }, to: { type: 'string', description: 'e.g. km, lb, fahrenheit' } },
        required: ['value', 'from', 'to'],
      },
      async run(args) {
        const v = num(args.value);
        if (v == null) return 'Error: "value" must be a number.';
        return convertUnits(v, str(args.from), str(args.to));
      },
    },
    {
      name: 'weather',
      web: true,
      description: 'Current weather and a 3-day forecast for a city or place.',
      parameters: { type: 'object', properties: { place: { type: 'string', description: 'city name, e.g. Pilani' } }, required: ['place'] },
      async run(args) {
        const place = str(args.place);
        if (!place) return 'Error: say which place.';
        try {
          const g = await deps.fetchText(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(place)}`, { headers: UA });
          const loc = JSON.parse(g.text)?.results?.[0];
          if (!loc) return `Error: I could not find a place called "${place}".`;
          const f = await deps.fetchText(
            `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&timezone=auto&forecast_days=3` +
              '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation' +
              '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
            { headers: UA },
          );
          const j = JSON.parse(f.text);
          const c = j.current;
          const lines = [
            `${loc.name}${loc.country ? `, ${loc.country}` : ''}: now ${Math.round(c.temperature_2m)}°C (feels ${Math.round(c.apparent_temperature)}°C), ${WEATHER[c.weather_code] ?? 'unknown'}, wind ${Math.round(c.wind_speed_10m)} km/h`,
          ];
          const d = j.daily;
          for (let i = 0; i < (d?.time?.length ?? 0); i++) {
            lines.push(`${d.time[i]}: ${Math.round(d.temperature_2m_min[i])}-${Math.round(d.temperature_2m_max[i])}°C, ${WEATHER[d.weather_code[i]] ?? ''}, rain chance ${d.precipitation_probability_max[i] ?? '?'}%`);
          }
          return lines.join('\n');
        } catch (e: any) {
          return 'Error: the weather service did not answer (offline or blocked). Tell the user you could not get the weather.';
        }
      },
    },
    {
      name: 'wikipedia',
      web: true,
      description: 'Short, reliable summary of a topic, person, place or concept from Wikipedia. Prefer this over web_search for general knowledge.',
      parameters: { type: 'object', properties: { topic: { type: 'string', description: 'e.g. "Birla Institute of Technology and Science"' } }, required: ['topic'] },
      async run(args) {
        const topic = str(args.topic);
        if (!topic) return 'Error: say which topic.';
        const summary = async (title: string) => {
          const r = await deps.fetchText(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, { headers: UA });
          if (r.status >= 400) return null;
          const j = JSON.parse(r.text);
          if (!j?.extract) return null;
          return `${j.title}: ${String(j.extract).slice(0, 1500)}\nSource: ${j?.content_urls?.desktop?.page ?? 'wikipedia.org'}`;
        };
        try {
          const direct = await summary(topic);
          if (direct) return direct;
          const r = await deps.fetchText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(topic)}`, { headers: UA });
          const best = JSON.parse(r.text)?.query?.search?.[0]?.title;
          const found = best ? await summary(best) : null;
          return found ?? `No Wikipedia article found for "${topic}".`;
        } catch {
          return 'Error: Wikipedia did not answer (offline or blocked). Tell the user you could not look it up.';
        }
      },
    },
    {
      name: 'web_search',
      description: 'Search the public web for outside facts only (not for the user\'s own tasks, reminders or deadlines). Returns titles, links and snippets. Follow up with fetch_url to read a page.',
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
            { headers: UA }, // Wikipedia answers requests without a User-Agent with a plain-text refusal, not JSON
          );
          const j = JSON.parse(r.text);
          const hits = (j?.query?.search ?? []).map((h: any) => ({
            title: String(h.title),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
            snippet: htmlToText(String(h.snippet ?? ''), 300),
          }));
          return formatHits(hits);
        } catch (e: any) {
          return 'Search failed: the search service did not return usable results (offline, blocked or rate limited). Do not retry; continue without it or tell the user.';
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
