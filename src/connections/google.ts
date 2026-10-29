import type { FetchFn } from './slack.ts';
import { decodeBase64Url, encodeHeader } from './codec.ts';
import { base64url, utf8 } from './pkce.ts';
import { htmlToText } from '../agents/html.ts';

// ---- OAuth (PKCE, no client secret) ---------------------------------------------------------

export type GoogleScope = 'calendar' | 'gmailRead' | 'gmailSend' | 'drive';

export const SCOPE_URLS: Record<GoogleScope, string> = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
};

export const SCOPE_LABELS: Record<GoogleScope, string> = {
  calendar: 'Calendar (read + create events)',
  gmailRead: 'Gmail (read)',
  gmailSend: 'Gmail (send)',
  drive: 'Drive (read)',
};

/** Must match the Android package name; the scheme is registered in app.json. */
export const REDIRECT_URI = 'com.codervlsi.lfm3pocket:/oauth2redirect';

export function buildAuthUrl(o: { clientId: string; scopes: GoogleScope[]; challenge: string; state: string; redirectUri?: string }): string {
  const q = {
    client_id: o.clientId,
    redirect_uri: o.redirectUri ?? REDIRECT_URI,
    response_type: 'code',
    scope: ['openid', 'email', ...o.scopes.map((s) => SCOPE_URLS[s])].join(' '),
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    access_type: 'offline',
    prompt: 'consent',
  };
  return `https://accounts.google.com/o/oauth2/v2/auth?${Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;
}

export function parseRedirect(url: string, expectedState: string): { code: string } | { error: string } | null {
  if (!url.startsWith(REDIRECT_URI.split(':')[0] + ':')) return null;
  const qs = url.split('?')[1] ?? '';
  const p: Record<string, string> = {};
  for (const part of qs.split('&')) {
    const [k, v] = part.split('=');
    if (k) p[decodeURIComponent(k)] = decodeURIComponent((v ?? '').replace(/\+/g, ' '));
  }
  if (p.error) return { error: `Google said: ${p.error}${p.error_description ? ` (${p.error_description})` : ''}` };
  if (p.state !== expectedState) return { error: 'The sign-in response did not match this request. Try again.' };
  if (!p.code) return { error: 'The sign-in response had no code.' };
  return { code: p.code };
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

async function tokenRequest(fetchFn: FetchFn, form: Record<string, string>, now: number): Promise<TokenSet> {
  const body = Object.entries(form)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error(`Google sign-in failed: ${j.error_description ?? j.error ?? `HTTP ${res.status}`}`);
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
}

export const exchangeCode = (fetchFn: FetchFn, o: { clientId: string; code: string; verifier: string; redirectUri?: string }, now = Date.now()) =>
  tokenRequest(fetchFn, { client_id: o.clientId, code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri ?? REDIRECT_URI, grant_type: 'authorization_code' }, now);

export const refreshAccessToken = (fetchFn: FetchFn, o: { clientId: string; refreshToken: string }, now = Date.now()) =>
  tokenRequest(fetchFn, { client_id: o.clientId, refresh_token: o.refreshToken, grant_type: 'refresh_token' }, now);

// ---- API client -----------------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtWhen(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export class GoogleClient {
  getToken: () => Promise<string>;
  fetchFn: FetchFn;

  constructor(getToken: () => Promise<string>, fetchFn: FetchFn) {
    this.getToken = getToken;
    this.fetchFn = fetchFn;
  }

  private async api(url: string, init?: { method?: string; body?: string }, raw = false): Promise<any> {
    const token = await this.getToken();
    const res = await this.fetchFn(url, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body,
    });
    if (!res.ok) {
      let msg = '';
      try {
        const j = await res.json();
        msg = j?.error?.message ?? '';
      } catch {
        // ignore
      }
      if (res.status === 403) throw new Error(`Google: permission denied. ${msg || 'Reconnect Google and tick this service.'}`);
      if (res.status === 401) throw new Error('Google: the sign-in expired. Reconnect Google.');
      throw new Error(`Google API error ${res.status}${msg ? `: ${msg}` : ''}`);
    }
    return raw ? res.text() : res.json();
  }

  // ---- Calendar
  async calendarEvents(days = 7, now = new Date()): Promise<string> {
    const max = new Date(now.getTime() + Math.min(Math.max(days, 1), 60) * 86_400_000);
    const j = await this.api(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=20&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(max.toISOString())}`,
    );
    const items: any[] = j.items ?? [];
    if (!items.length) return `No events in the next ${days} day(s).`;
    return items
      .map((e) => {
        const allDay = !!e.start?.date;
        const s = new Date(e.start?.dateTime ?? e.start?.date);
        const en = new Date(e.end?.dateTime ?? e.end?.date);
        const when = allDay ? `${fmtWhen(s).slice(0, 14)} (all day)` : `${fmtWhen(s)}–${p2(en.getHours())}:${p2(en.getMinutes())}`;
        return `${when}  ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}`;
      })
      .join('\n');
  }

  async calendarCreate(o: { title: string; start: string; end?: string; description?: string }): Promise<string> {
    const start = new Date(o.start);
    if (isNaN(start.getTime())) throw new Error('Calendar: the start time could not be understood. Use a local date-time like 2026-10-30T15:00.');
    const end = o.end ? new Date(o.end) : new Date(start.getTime() + 3_600_000);
    if (isNaN(end.getTime()) || end <= start) throw new Error('Calendar: the end time must be after the start time.');
    await this.api('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({ summary: o.title, description: o.description, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }),
    });
    return `Created "${o.title}" on ${fmtWhen(start)}.`;
  }

  // ---- Gmail
  async gmailSearch(query: string, max = 8): Promise<string> {
    const list = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(max, 15)}&q=${encodeURIComponent(query)}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    if (!ids.length) return 'No messages found.';
    const rows: string[] = [];
    for (const id of ids) {
      const m = await this.api(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      rows.push(`[${id}] ${h('Date').slice(0, 22)} | ${h('From')} | ${h('Subject') || '(no subject)'}\n    ${String(m.snippet ?? '').slice(0, 140)}`);
    }
    return rows.join('\n');
  }

  async gmailRead(id: string): Promise<string> {
    const m = await this.api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
    const parts: any[] = [];
    const walk = (p: any) => {
      if (!p) return;
      if (p.body?.data) parts.push(p);
      (p.parts ?? []).forEach(walk);
    };
    walk(m.payload);
    const plain = parts.find((p) => p.mimeType === 'text/plain');
    const html = parts.find((p) => p.mimeType === 'text/html');
    const body = plain ? decodeBase64Url(plain.body.data) : html ? htmlToText(decodeBase64Url(html.body.data), 4000) : String(m.snippet ?? '');
    return `From: ${h('From')}\nTo: ${h('To')}\nDate: ${h('Date')}\nSubject: ${h('Subject')}\n\n${body.trim().slice(0, 4000)}`;
  }

  async gmailSend(o: { to: string; subject: string; body: string }): Promise<string> {
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(o.to.trim())) throw new Error('Gmail: "to" must be a single valid email address.');
    const raw = [
      `To: ${o.to.trim()}`,
      `Subject: ${encodeHeader(o.subject.replace(/[\r\n]+/g, ' '), utf8)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      o.body,
    ].join('\r\n');
    await this.api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: base64url(utf8(raw)) }) });
    return `Email sent to ${o.to.trim()}.`;
  }

  // ---- Drive
  async driveSearch(query: string, max = 10): Promise<string> {
    const safe = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `fullText contains '${safe}' and trashed = false`;
    const j = await this.api(
      `https://www.googleapis.com/drive/v3/files?pageSize=${Math.min(max, 20)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}&q=${encodeURIComponent(q)}`,
    );
    const files: any[] = j.files ?? [];
    if (!files.length) return 'No files found.';
    return files.map((f) => `[${f.id}] ${f.name}  (${String(f.mimeType).replace('application/vnd.google-apps.', 'google ')}, edited ${String(f.modifiedTime).slice(0, 10)})`).join('\n');
  }

  async driveRead(id: string): Promise<string> {
    const meta = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType`);
    const mime: string = meta.mimeType ?? '';
    let text: string;
    if (mime === 'application/vnd.google-apps.document' || mime === 'application/vnd.google-apps.presentation') {
      text = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text/plain`, undefined, true);
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      text = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=text/csv`, undefined, true);
    } else if (/^text\//.test(mime) || mime === 'application/json') {
      text = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, undefined, true);
    } else {
      return `"${meta.name}" is a ${mime} file; only documents, sheets, slides and text files can be read.`;
    }
    return `${meta.name}\n\n${text.trim().slice(0, 5000)}`;
  }
}
