export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

const HINTS: Record<string, string> = {
  invalid_auth: 'The token is not valid. Paste the Bot User OAuth Token (starts with xoxb-).',
  not_authed: 'No token. Connect Slack first.',
  token_revoked: 'The token was revoked. Create a new one and reconnect.',
  channel_not_found: 'Channel not found. The bot may need to be invited to it (/invite @your-bot).',
  not_in_channel: 'The bot is not in that channel. Invite it with /invite @your-bot.',
};

export class SlackClient {
  token: string;
  fetchFn: FetchFn;
  private users: Map<string, string> | null = null;

  constructor(token: string, fetchFn: FetchFn) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private async call(method: string, params: Record<string, string | number | boolean> = {}, body?: Record<string, unknown>): Promise<any> {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const res = await this.fetchFn(`https://slack.com/api/${method}${qs ? '?' + qs : ''}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Slack returned HTTP ${res.status}`);
    const j = await res.json();
    if (!j.ok) {
      const needed = j.needed ? ` (needs scope: ${j.needed})` : '';
      throw new Error(`Slack: ${HINTS[j.error] ?? j.error}${needed}`);
    }
    return j;
  }

  async authTest(): Promise<{ team: string; user: string }> {
    const j = await this.call('auth.test');
    return { team: String(j.team ?? ''), user: String(j.user ?? '') };
  }

  async channels(): Promise<SlackChannel[]> {
    const j = await this.call('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 200 });
    return (j.channels ?? []).map((c: any) => ({ id: String(c.id), name: String(c.name), isPrivate: !!c.is_private, isMember: !!c.is_member }));
  }

  /** accepts "#general", "general" or an id like C0123 */
  async resolveChannel(ref: string): Promise<SlackChannel> {
    const wanted = ref.trim().replace(/^#/, '').toLowerCase();
    if (/^[CGD][A-Z0-9]{6,}$/.test(ref.trim())) return { id: ref.trim(), name: ref.trim(), isPrivate: false, isMember: true };
    const found = (await this.channels()).find((c) => c.name.toLowerCase() === wanted);
    if (!found) throw new Error(`Slack: no channel called "${ref}" that the bot can see.`);
    return found;
  }

  private async userName(id: string): Promise<string> {
    if (!this.users) {
      this.users = new Map();
      try {
        const j = await this.call('users.list', { limit: 200 });
        for (const u of j.members ?? []) this.users.set(String(u.id), String(u.profile?.display_name || u.real_name || u.name || u.id));
      } catch {
        // missing users:read: fall back to ids
      }
    }
    return this.users.get(id) ?? id;
  }

  async history(channelRef: string, limit = 15): Promise<string> {
    const ch = await this.resolveChannel(channelRef);
    const j = await this.call('conversations.history', { channel: ch.id, limit: Math.min(Math.max(limit, 1), 40) });
    const msgs: any[] = (j.messages ?? []).slice().reverse();
    if (!msgs.length) return `#${ch.name} has no recent messages.`;
    const lines: string[] = [];
    for (const m of msgs) {
      const who = m.user ? await this.userName(String(m.user)) : String(m.username ?? m.bot_id ?? 'bot');
      const when = new Date(Number(m.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`[${when}] ${who}: ${String(m.text ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    return `Recent messages in #${ch.name}:\n${lines.join('\n')}`;
  }

  async post(channelRef: string, text: string): Promise<string> {
    const ch = await this.resolveChannel(channelRef);
    await this.call('chat.postMessage', {}, { channel: ch.id, text });
    return `Posted to #${ch.name}.`;
  }
}

export function formatChannels(chs: SlackChannel[]): string {
  if (!chs.length) return 'The bot cannot see any channels. Invite it to some with /invite.';
  return chs.map((c) => `#${c.name}${c.isPrivate ? ' (private)' : ''}${c.isMember ? '' : ' (bot not a member)'}`).join('\n');
}
