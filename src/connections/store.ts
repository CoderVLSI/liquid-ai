import { Linking } from 'react-native';
import { native } from '../native';
import { log, stringify } from '../lib/log';
import { createStore } from '../state/store';
import type { Tool } from '../agents/types';
import { challengeFor, newVerifier } from './pkce';
import { SlackClient } from './slack';
import type { FetchFn } from './slack';
import { GoogleClient, REDIRECT_URI, buildAuthUrl, exchangeCode, parseRedirect, refreshAccessToken } from './google';
import type { GoogleScope } from './google';
import { googleTools, slackTools } from './tools';

export interface GoogleConn {
  clientId: string;
  scopes: GoogleScope[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export interface ConnState {
  loaded: boolean;
  slack: { token: string; team: string; user: string } | null;
  google: GoogleConn | null;
  /** a Google sign-in that is waiting for the browser to come back */
  pendingGoogle: { verifier: string; state: string; clientId: string; scopes: GoogleScope[] } | null;
  busy: string | null;
  error: string | null;
}

export const connStore = createStore<ConnState>({ loaded: false, slack: null, google: null, pendingGoogle: null, busy: null, error: null });

const file = () => `${native.info().filesDir}/connections.json`;

function save() {
  const { slack, google, pendingGoogle } = connStore.get();
  try {
    native.writeText(file(), JSON.stringify({ slack, google, pendingGoogle }), false);
  } catch (e) {
    log.warn('connections', 'save failed', stringify(e));
  }
}

const httpFetch: FetchFn = async (url, init) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    return (await fetch(url, { ...init, signal: ctl.signal })) as any;
  } finally {
    clearTimeout(timer);
  }
};

export async function startConnections() {
  try {
    const raw = await native.readText(file());
    if (raw) {
      const j = JSON.parse(raw);
      connStore.set({ slack: j.slack ?? null, google: j.google ?? null, pendingGoogle: j.pendingGoogle ?? null });
    }
  } catch (e) {
    log.warn('connections', 'load failed', stringify(e));
  }
  connStore.set({ loaded: true });
  // the browser hands the Google sign-in back to the app through a custom-scheme link
  Linking.addEventListener('url', (e) => void handleRedirect(e.url));
  const initial = await Linking.getInitialURL().catch(() => null);
  if (initial) void handleRedirect(initial);
}

// ---- Slack ------------------------------------------------------------------------------------

export async function connectSlack(token: string) {
  const t = token.trim();
  if (!t) return;
  connStore.set({ busy: 'slack', error: null });
  try {
    const who = await new SlackClient(t, httpFetch).authTest();
    connStore.set({ slack: { token: t, ...who } });
    save();
    log.info('connections', `Slack connected: ${who.team} as ${who.user}`);
  } catch (e: any) {
    connStore.set({ error: String(e?.message ?? e) });
  } finally {
    connStore.set({ busy: null });
  }
}

export function disconnectSlack() {
  connStore.set({ slack: null });
  save();
}

// ---- Google -----------------------------------------------------------------------------------

export function startGoogleSignIn(clientId: string, scopes: GoogleScope[]) {
  const id = clientId.trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
    connStore.set({ error: 'That does not look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).' });
    return;
  }
  if (!scopes.length) {
    connStore.set({ error: 'Tick at least one Google service.' });
    return;
  }
  const verifier = newVerifier();
  const state = newVerifier().slice(0, 24);
  connStore.set({ pendingGoogle: { verifier, state, clientId: id, scopes }, error: null, busy: 'google' });
  save();
  const url = buildAuthUrl({ clientId: id, scopes, challenge: challengeFor(verifier), state });
  Linking.openURL(url).catch((e) => connStore.set({ error: `Could not open the browser: ${e?.message ?? e}`, busy: null }));
}

async function handleRedirect(url: string) {
  const pending = connStore.get().pendingGoogle;
  if (!url.startsWith(REDIRECT_URI.split(':')[0] + ':')) return;
  if (!pending) {
    connStore.set({ error: 'Received a Google sign-in response, but no sign-in was in progress.' });
    return;
  }
  const r = parseRedirect(url, pending.state);
  if (!r) return;
  if ('error' in r) {
    connStore.set({ error: r.error, busy: null, pendingGoogle: null });
    save();
    return;
  }
  connStore.set({ busy: 'google', error: null });
  try {
    const t = await exchangeCode(httpFetch, { clientId: pending.clientId, code: r.code, verifier: pending.verifier });
    let email: string | undefined;
    try {
      const u = await httpFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.accessToken}` } });
      email = (await u.json()).email;
    } catch {
      // cosmetic only
    }
    connStore.set({
      google: { clientId: pending.clientId, scopes: pending.scopes, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, email },
      pendingGoogle: null,
    });
    save();
    log.info('connections', `Google connected${email ? ` as ${email}` : ''}`);
  } catch (e: any) {
    connStore.set({ error: String(e?.message ?? e), pendingGoogle: null });
    save();
  } finally {
    connStore.set({ busy: null });
  }
}

async function googleToken(): Promise<string> {
  const g = connStore.get().google;
  if (!g?.accessToken) throw new Error('Google is not connected.');
  if ((g.expiresAt ?? 0) - 60_000 > Date.now()) return g.accessToken;
  if (!g.refreshToken) throw new Error('Google: the sign-in expired. Reconnect Google.');
  const t = await refreshAccessToken(httpFetch, { clientId: g.clientId, refreshToken: g.refreshToken });
  connStore.set({ google: { ...g, accessToken: t.accessToken, expiresAt: t.expiresAt, refreshToken: t.refreshToken ?? g.refreshToken } });
  save();
  return t.accessToken;
}

export function disconnectGoogle() {
  const g = connStore.get().google;
  connStore.set({ google: null, pendingGoogle: null });
  save();
  const tok = g?.refreshToken ?? g?.accessToken;
  if (tok) httpFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' }).catch(() => {});
}

// ---- tools for the agents ---------------------------------------------------------------------

export function connectionTools(): Tool[] {
  const s = connStore.get();
  const out: Tool[] = [];
  if (s.slack) out.push(...slackTools(new SlackClient(s.slack.token, httpFetch)));
  if (s.google) out.push(...googleTools(new GoogleClient(googleToken, httpFetch), s.google.scopes));
  return out;
}
