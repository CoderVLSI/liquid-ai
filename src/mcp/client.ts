import type { McpServerConfig } from './types.ts';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
}

export interface HttpReply {
  status: number;
  header(name: string): string | null;
  text(): Promise<string>;
}

/** POST with a timeout, supplied by the host (fetch in the app, a fake in tests). */
export type Poster = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<HttpReply>;

const PROTOCOL = '2025-06-18';

/** Reads the JSON-RPC message answering `id` out of a plain JSON body or a text/event-stream body. */
export function parseRpcBody(body: string, contentType: string, id: number | null): any {
  const wanted = (m: any) => m && typeof m === 'object' && (id == null || m.id === id);
  if (/text\/event-stream/i.test(contentType)) {
    let found: any = null;
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const m = JSON.parse(data);
        if (wanted(m) && ('result' in m || 'error' in m)) found = m;
      } catch {
        // not JSON (a keep-alive comment): ignore
      }
    }
    return found;
  }
  if (!body.trim()) return null;
  const m = JSON.parse(body);
  return Array.isArray(m) ? m.find(wanted) ?? null : m;
}

/**
 * A small MCP client for the "streamable HTTP" transport: JSON-RPC over POST, replies as JSON or as an event stream.
 * That is what current remote MCP servers speak. (The older two-endpoint SSE transport is not supported.)
 */
export class McpClient {
  readonly cfg: McpServerConfig;
  private post: Poster;
  private sessionId = '';
  private nextId = 1;
  private ready = false;
  serverName = '';

  constructor(cfg: McpServerConfig, post: Poster) {
    this.cfg = cfg;
    this.post = post;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.cfg.token.trim()) h.Authorization = `Bearer ${this.cfg.token.trim()}`;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.ready) h['MCP-Protocol-Version'] = PROTOCOL;
    return h;
  }

  private async send(message: Record<string, unknown>, expectReply: boolean): Promise<any> {
    const id = expectReply ? (message.id as number) : null;
    let reply: HttpReply;
    try {
      reply = await this.post(this.cfg.url, { headers: this.headers(), body: JSON.stringify(message) });
    } catch (e: any) {
      throw new Error(`Could not reach ${this.cfg.name} (${e?.message ?? e}). Is the server running and reachable from the phone?`);
    }
    const sid = reply.header('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await reply.text();
    if (reply.status === 401 || reply.status === 403) throw new Error(`${this.cfg.name} refused the connection (HTTP ${reply.status}). Check the access token.`);
    if (reply.status === 404 || reply.status === 405) {
      throw new Error(`${this.cfg.name} answered HTTP ${reply.status}. Check the URL (it usually ends in /mcp); older SSE-only servers are not supported.`);
    }
    if (reply.status >= 400) throw new Error(`${this.cfg.name} answered HTTP ${reply.status}: ${text.slice(0, 200)}`);
    if (!expectReply) return null;
    const m = parseRpcBody(text, reply.header('content-type') ?? '', id);
    if (!m) throw new Error(`${this.cfg.name} sent no answer to ${String(message.method)}.`);
    if (m.error) throw new Error(`${this.cfg.name}: ${m.error.message ?? JSON.stringify(m.error)}`);
    return m.result;
  }

  private rpc(method: string, params?: Record<string, unknown>): Promise<any> {
    return this.send({ jsonrpc: '2.0', id: this.nextId++, method, params: params ?? {} }, true);
  }

  async initialize(): Promise<string> {
    const r = await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'LFM3 Pocket', version: '1.0' } });
    this.serverName = String(r?.serverInfo?.name ?? this.cfg.name);
    this.ready = true;
    try {
      await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
    } catch {
      // some servers answer the notification oddly; the session is usable anyway
    }
    return this.serverName;
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.ready) await this.initialize();
    const out: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.rpc('tools/list', cursor ? { cursor } : {});
      for (const t of r?.tools ?? []) if (t && typeof t.name === 'string') out.push({ name: t.name, description: t.description, inputSchema: t.inputSchema });
      cursor = r?.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  /** Runs a tool and returns its text. Tool-level failures come back as "Error: ..." text for the model to read. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.ready) await this.initialize();
    const r = await this.rpc('tools/call', { name, arguments: args });
    const parts: string[] = [];
    for (const c of r?.content ?? []) {
      if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
      else if (c?.type === 'image') parts.push('[image]');
      else if (c?.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]`);
    }
    if (!parts.length && r?.structuredContent) parts.push(JSON.stringify(r.structuredContent));
    const text = parts.join('\n') || '(no output)';
    return r?.isError ? `Error: ${text}` : text;
  }
}
