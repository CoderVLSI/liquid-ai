import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'UTC';
import { base64, base64urlToBytes, bytesToUtf8, decodeBase64Url, encodeHeader } from './codec.ts';
import { SlackClient } from './slack.ts';
import type { FetchFn, HttpResponse } from './slack.ts';
import { GoogleClient, REDIRECT_URI, buildAuthUrl, exchangeCode, parseRedirect, refreshAccessToken } from './google.ts';
import { base64url, utf8 } from './pkce.ts';

const res = (body: unknown, status = 200): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** A fake network: routes by substring, records every call. */
function net(routes: Record<string, unknown | ((init: any) => unknown)>) {
  const calls: { url: string; init: any }[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    for (const [k, v] of Object.entries(routes)) {
      if (url.includes(k)) {
        const out = typeof v === 'function' ? (v as any)(init) : v;
        return out && (out as any).__status ? res((out as any).body, (out as any).__status) : res(out);
      }
    }
    return res({ ok: false, error: 'no_route:' + url }, 404);
  };
  return { fn, calls };
}

// ---- codec ----------------------------------------------------------------------------------

test('base64 round trips and matches Buffer', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'héllo 日本 🙂']) {
    const bytes = utf8(s);
    assert.equal(base64(bytes), Buffer.from(s, 'utf8').toString('base64'));
    assert.equal(bytesToUtf8(base64urlToBytes(base64url(bytes))), s);
  }
  assert.equal(decodeBase64Url(base64url(utf8('hello, wörld'))), 'hello, wörld');
});

test('non-ASCII email subjects become RFC 2047 words, ASCII stays', () => {
  assert.equal(encodeHeader('Hello', utf8), 'Hello');
  assert.equal(encodeHeader('Café ☕', utf8), `=?UTF-8?B?${Buffer.from('Café ☕').toString('base64')}?=`);
});

// ---- Slack ----------------------------------------------------------------------------------

test('Slack: lists channels, resolves names, reads history with user names', async () => {
  const { fn, calls } = net({
    'auth.test': { ok: true, team: 'Acme', user: 'pocketbot' },
    'conversations.list': { ok: true, channels: [{ id: 'C1', name: 'general', is_member: true }, { id: 'C2', name: 'secret', is_private: true, is_member: false }] },
    'users.list': { ok: true, members: [{ id: 'U1', name: 'sam', profile: { display_name: 'Sam' } }] },
    'conversations.history': { ok: true, messages: [{ user: 'U1', text: 'second', ts: '1761800060' }, { user: 'U1', text: 'first', ts: '1761800000' }] },
  });
  const s = new SlackClient('xoxb-token', fn);
  assert.deepEqual(await s.authTest(), { team: 'Acme', user: 'pocketbot' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer xoxb-token');
  const h = await s.history('#general', 5);
  assert.match(h, /#general/);
  assert.ok(h.indexOf('first') < h.indexOf('second'), 'oldest first');
  assert.match(h, /Sam: first/);
});

test('Slack: posting goes out as JSON to the resolved channel id', async () => {
  const { fn, calls } = net({
    'conversations.list': { ok: true, channels: [{ id: 'C1', name: 'general', is_member: true }] },
    'chat.postMessage': { ok: true },
  });
  assert.equal(await new SlackClient('t', fn).post('general', 'hello team'), 'Posted to #general.');
  const post = calls.find((c) => c.url.includes('chat.postMessage'))!;
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { channel: 'C1', text: 'hello team' });
});

test('Slack: errors come with an actionable hint', async () => {
  const { fn } = net({ 'auth.test': { ok: false, error: 'invalid_auth' }, 'conversations.list': { ok: false, error: 'missing_scope', needed: 'channels:read' } });
  await assert.rejects(new SlackClient('bad', fn).authTest(), /xoxb-/);
  await assert.rejects(new SlackClient('t', fn).channels(), /needs scope: channels:read/);
});

test('Slack: unknown channels are reported clearly', async () => {
  const { fn } = net({ 'conversations.list': { ok: true, channels: [] } });
  await assert.rejects(new SlackClient('t', fn).post('nope', 'x'), /no channel called "nope"/);
});

// ---- Google OAuth -----------------------------------------------------------------------------

test('auth url carries PKCE, offline access and the chosen scopes only', () => {
  const u = buildAuthUrl({ clientId: 'cid.apps.googleusercontent.com', scopes: ['calendar', 'gmailRead'], challenge: 'CH', state: 'ST' });
  assert.match(u, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(u, /code_challenge=CH&code_challenge_method=S256/);
  assert.match(u, /access_type=offline/);
  assert.match(u, /calendar\.events/);
  assert.match(u, /gmail\.readonly/);
  assert.doesNotMatch(u, /gmail\.send|drive/);
  assert.ok(u.includes(encodeURIComponent(REDIRECT_URI)));
});

test('redirect parsing checks state, errors and ignores unrelated urls', () => {
  assert.deepEqual(parseRedirect(`${REDIRECT_URI}?state=S&code=abc%2F123`, 'S'), { code: 'abc/123' });
  assert.match((parseRedirect(`${REDIRECT_URI}?state=OTHER&code=x`, 'S') as any).error, /did not match/);
  assert.match((parseRedirect(`${REDIRECT_URI}?error=access_denied`, 'S') as any).error, /access_denied/);
  assert.equal(parseRedirect('https://example.com/?code=1', 'S'), null);
});

test('code exchange and refresh use the token endpoint with the right form', async () => {
  const { fn, calls } = net({ 'oauth2.googleapis.com/token': { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } });
  const t = await exchangeCode(fn, { clientId: 'cid', code: 'c0de', verifier: 'ver' }, 1000);
  assert.deepEqual(t, { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3_600_000 });
  assert.match(calls[0].init.body, /grant_type=authorization_code/);
  assert.match(calls[0].init.body, /code_verifier=ver/);
  assert.ok(!/client_secret/.test(calls[0].init.body));
  await refreshAccessToken(fn, { clientId: 'cid', refreshToken: 'RT' }, 0);
  assert.match(calls[1].init.body, /grant_type=refresh_token/);
});

test('token errors explain themselves', async () => {
  const { fn } = net({ 'token': { __status: 400, body: { error: 'invalid_grant', error_description: 'Bad code' } } });
  await assert.rejects(exchangeCode(fn, { clientId: 'c', code: 'x', verifier: 'v' }), /Bad code/);
});

// ---- Google APIs ------------------------------------------------------------------------------

const google = (routes: Record<string, unknown>) => {
  const n = net(routes);
  return { g: new GoogleClient(async () => 'TOKEN', n.fn), ...n };
};

test('Calendar: lists upcoming events and creates one', async () => {
  const { g, calls } = google({
    'calendars/primary/events?': { items: [{ summary: 'Standup', start: { dateTime: '2026-10-30T09:00:00Z' }, end: { dateTime: '2026-10-30T09:15:00Z' } }, { summary: 'Holiday', start: { date: '2026-10-31' }, end: { date: '2026-11-01' } }] },
    'calendars/primary/events': { id: 'e1' },
  });
  const out = await g.calendarEvents(7, new Date('2026-10-29T12:00:00Z'));
  assert.match(out, /Fri 2026-10-30 09:00–09:15  Standup/);
  assert.match(out, /\(all day\)  Holiday/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer TOKEN');

  assert.match(await g.calendarCreate({ title: 'Lunch', start: '2026-10-30T12:00:00Z' }), /Created "Lunch"/);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.end.dateTime, '2026-10-30T13:00:00.000Z'); // defaults to one hour
  await assert.rejects(g.calendarCreate({ title: 'x', start: 'not a date' }), /could not be understood/);
  await assert.rejects(g.calendarCreate({ title: 'x', start: '2026-10-30T12:00:00Z', end: '2026-10-30T11:00:00Z' }), /after the start/);
});

test('Gmail: searches with headers, reads the plain-text body, sends valid MIME', async () => {
  const text = base64url(utf8('Hi there,\nSee you at 3.'));
  const { g, calls } = google({
    'messages?maxResults': { messages: [{ id: 'm1' }] },
    'messages/m1?format=metadata': { snippet: 'Hi there', payload: { headers: [{ name: 'From', value: 'Ann <ann@x.com>' }, { name: 'Subject', value: 'Plans' }, { name: 'Date', value: 'Wed, 29 Oct 2026 10:00:00 +0000' }] } },
    'messages/m1?format=full': { payload: { headers: [{ name: 'Subject', value: 'Plans' }], parts: [{ mimeType: 'text/plain', body: { data: text } }, { mimeType: 'text/html', body: { data: base64url(utf8('<b>x</b>')) } }] } },
    'messages/send': { id: 's1' },
  });
  assert.match(await g.gmailSearch('from:ann'), /\[m1\].*Ann <ann@x.com> \| Plans/);
  const read = await g.gmailRead('m1');
  assert.match(read, /Subject: Plans/);
  assert.match(read, /See you at 3\./);

  assert.equal(await g.gmailSend({ to: 'bob@y.org', subject: 'Café', body: 'Hello Bob' }), 'Email sent to bob@y.org.');
  const sent = JSON.parse(calls.at(-1)!.init.body);
  const raw = bytesToUtf8(base64urlToBytes(sent.raw));
  assert.match(raw, /^To: bob@y\.org\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /\r\n\r\nHello Bob$/);
  await assert.rejects(g.gmailSend({ to: 'not-an-email', subject: 's', body: 'b' }), /valid email/);
  await assert.rejects(g.gmailSend({ to: 'a@b.co, c@d.co', subject: 's', body: 'b' }), /single valid email/);
});

test('Drive: searches (escaping quotes) and reads docs, sheets and text; refuses binaries', async () => {
  const { g, calls } = google({
    'files?pageSize': { files: [{ id: 'f1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T00:00:00Z' }] },
    'files/doc?fields': { name: 'Plan', mimeType: 'application/vnd.google-apps.document' },
    'files/doc/export?mimeType=text/plain': 'Chapter one',
    'files/pdf?fields': { name: 'a.pdf', mimeType: 'application/pdf' },
  });
  assert.match(await g.driveSearch("it's"), /\[f1\] Plan {2}\(google document/);
  assert.match(decodeURIComponent(calls[0].url), /fullText contains 'it\\'s'/);
  assert.match(await g.driveRead('doc'), /Plan\n\nChapter one/);
  assert.match(await g.driveRead('pdf'), /only documents, sheets, slides and text files/);
});

test('API errors turn into advice the agent can relay', async () => {
  const n = net({ 'calendar': { __status: 403, body: { error: { message: 'Insufficient Permission' } } } });
  const g = new GoogleClient(async () => 'T', n.fn);
  await assert.rejects(g.calendarEvents(), /permission denied/);
  const n2 = net({ 'calendar': { __status: 401, body: {} } });
  await assert.rejects(new GoogleClient(async () => 'T', n2.fn).calendarEvents(), /expired/);
});

// ---- agent tools ------------------------------------------------------------------------------

import { googleTools, slackTools } from './tools.ts';

test('only the services the user ticked become tools; writes carry an approval text', () => {
  const g = new GoogleClient(async () => 'T', net({}).fn);
  const names = (scopes: any[]) => googleTools(g, scopes).map((t) => t.name);
  assert.deepEqual(names(['calendar']), ['calendar_list_events', 'calendar_create_event']);
  assert.deepEqual(names(['gmailRead']), ['gmail_search', 'gmail_read']);
  assert.deepEqual(names(['gmailSend']), ['gmail_send']);
  assert.deepEqual(names([]), []);

  const all = googleTools(g, ['calendar', 'gmailRead', 'gmailSend', 'drive']);
  const writes = all.filter((t) => t.approval).map((t) => t.name).sort();
  assert.deepEqual(writes, ['calendar_create_event', 'gmail_send']);
  assert.match(all.find((t) => t.name === 'gmail_send')!.approval!({ to: 'a@b.co', subject: 'Hi', body: 'Body' }), /a@b\.co[\s\S]*Hi[\s\S]*Body/);

  const s = slackTools(new SlackClient('t', net({}).fn));
  assert.deepEqual(s.filter((t) => t.approval).map((t) => t.name), ['slack_post_message']);
});

test('tool failures come back as text the model can act on, never exceptions', async () => {
  const { fn } = net({ 'conversations.list': { ok: false, error: 'invalid_auth' } });
  const tools = slackTools(new SlackClient('bad', fn));
  const out = await tools.find((t) => t.name === 'slack_list_channels')!.run({});
  assert.match(out, /^Error: Slack:/);
});

test('calendar tool passes arguments through and coerces numbers', async () => {
  const { fn, calls } = net({ 'calendars/primary/events': { items: [] } });
  const tools = googleTools(new GoogleClient(async () => 'T', fn), ['calendar'], () => new Date('2026-10-29T00:00:00Z'));
  assert.match(await tools[0].run({ days: '3' }), /No events in the next 3 day/);
  assert.match(calls[0].url, /timeMax=2026-11-01/);
});

test('calendar times are read on the user\'s clock and sent as exact instants', async () => {
  const { wallToIso } = await import('./tools.ts');
  assert.equal(wallToIso('2026-10-30T15:00', 'Asia/Kolkata'), '2026-10-30T09:30:00.000Z');
  assert.equal(wallToIso('2026-10-30T15:00', 'UTC'), '2026-10-30T15:00:00.000Z');
  assert.equal(wallToIso('2026-10-30T15:00:00Z', 'Asia/Kolkata'), '2026-10-30T15:00:00Z'); // already exact
  assert.equal(wallToIso('next friday', 'UTC'), 'next friday'); // not ours to parse
});
