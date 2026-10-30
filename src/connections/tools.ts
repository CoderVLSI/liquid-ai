import { fromWall, resolveZone } from '../lib/tz.ts';
import type { Tool } from '../agents/types.ts';
import type { GoogleClient, GoogleScope } from './google.ts';
import type { SlackClient } from './slack.ts';
import { formatChannels } from './slack.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const num = (v: unknown, d: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
};

const wrap = (fn: () => Promise<string>) => async (): Promise<string> => {
  try {
    return await fn();
  } catch (e: any) {
    return `Error: ${e?.message ?? e}`;
  }
};

export function slackTools(slack: SlackClient): Tool[] {
  return [
    {
      name: 'slack_list_channels',
      description: 'List the Slack channels the bot can see.',
      parameters: { type: 'object', properties: {} },
      run: wrap(async () => formatChannels(await slack.channels())),
    },
    {
      name: 'slack_read_channel',
      description: 'Read the most recent messages of a Slack channel.',
      parameters: {
        type: 'object',
        properties: { channel: { type: 'string', description: 'channel name, e.g. general' }, limit: { type: 'number', description: 'how many messages (default 15)' } },
        required: ['channel'],
      },
      run: (a) => wrap(() => slack.history(str(a.channel), num(a.limit, 15)))(),
    },
    {
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel.',
      parameters: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] },
      approval: (a) => `Post to Slack #${str(a.channel).replace(/^#/, '')}:\n"${str(a.text)}"`,
      run: (a) => wrap(() => slack.post(str(a.channel), str(a.text)))(),
    },
  ];
}

/** "2026-10-30T15:00" is a time on the user's clock; the calendar API wants an exact instant. */
export function wallToIso(text: string, zone: string): string {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(.*)$/);
  if (!m || /^(z|[+-]\d{2}:?\d{2})/i.test(m[6].trim())) return text; // unparsable, or it carries its own offset
  const wall = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, 0, 0);
  return fromWall(wall, resolveZone(zone)).toISOString();
}

export function googleTools(google: GoogleClient, scopes: GoogleScope[], now: () => Date = () => new Date(), zone: () => string = () => 'auto'): Tool[] {
  const out: Tool[] = [];
  if (scopes.includes('calendar')) {
    out.push(
      {
        name: 'calendar_list_events',
        description: 'List upcoming Google Calendar events.',
        parameters: { type: 'object', properties: { days: { type: 'number', description: 'how many days ahead (default 7)' } } },
        run: (a) => wrap(() => google.calendarEvents(num(a.days, 7), now()))(),
      },
      {
        name: 'calendar_create_event',
        description: 'Create a Google Calendar event. Times are local, like 2026-10-30T15:00.',
        parameters: {
          type: 'object',
          properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string', description: 'optional, defaults to 1 hour after start' }, description: { type: 'string' } },
          required: ['title', 'start'],
        },
        approval: (a) => `Create calendar event "${str(a.title)}" starting ${str(a.start)}${a.end ? ` until ${str(a.end)}` : ''}.`,
        run: (a) => wrap(() => google.calendarCreate({ title: str(a.title), start: wallToIso(str(a.start), zone()), end: str(a.end) ? wallToIso(str(a.end), zone()) : undefined, description: str(a.description) || undefined }))(),
      },
    );
  }
  if (scopes.includes('gmailRead')) {
    out.push(
      {
        name: 'gmail_search',
        description: 'Search Gmail using Gmail search syntax (e.g. "from:ann is:unread newer_than:2d"). Returns ids, senders, subjects and snippets.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
        run: (a) => wrap(() => google.gmailSearch(str(a.query), num(a.max, 8)))(),
      },
      {
        name: 'gmail_read',
        description: 'Read one email by its id (from gmail_search).',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        run: (a) => wrap(() => google.gmailRead(str(a.id)))(),
      },
    );
  }
  if (scopes.includes('gmailSend')) {
    out.push({
      name: 'gmail_send',
      description: 'Send a plain-text email from the user\'s Gmail account.',
      parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] },
      approval: (a) => `Send an email to ${str(a.to)}\nSubject: ${str(a.subject)}\n\n${str(a.body)}`,
      run: (a) => wrap(() => google.gmailSend({ to: str(a.to), subject: str(a.subject), body: str(a.body) }))(),
    });
  }
  if (scopes.includes('drive')) {
    out.push(
      {
        name: 'drive_search',
        description: 'Search Google Drive file names and contents.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        run: (a) => wrap(() => google.driveSearch(str(a.query)))(),
      },
      {
        name: 'drive_read',
        description: 'Read the text of a Google Doc, Sheet, Slides or text file by id (from drive_search).',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        run: (a) => wrap(() => google.driveRead(str(a.id)))(),
      },
    );
  }
  return out;
}
