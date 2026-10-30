import { log, stringify } from '../lib/log';
import { createStore } from '../state/store';
import { appStore } from '../state/app';
import type { Skill } from '../agents/skills';
import type { Tool } from '../agents/types';
import { McpClient } from './client';
import type { Poster } from './client';
import { adaptTool, serverSkill } from './adapter';
import type { McpServerConfig } from './types';

export interface McpStatus {
  state: 'connecting' | 'ready' | 'error';
  tools: string[];
  error?: string;
  serverName?: string;
}

export const mcpStore = createStore<{ status: Record<string, McpStatus> }>({ status: {} });

const post: Poster = async (url, init) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: ctl.signal });
    const text = await r.text();
    return { status: r.status, header: (n: string) => r.headers.get(n), text: async () => text };
  } catch (e: any) {
    throw new Error(ctl.signal.aborted ? 'timed out after 25 s' : String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
};

const fingerprint = (c: McpServerConfig) => [c.name, c.url, c.token, c.enabled, c.approve, c.kind].join('|');

class McpManager {
  private tools = new Map<string, Tool[]>();
  private skillList = new Map<string, Skill>();
  private prints = new Map<string, string>();
  private loading = new Map<string, Promise<void>>();

  /** Reconnect servers whenever the list in the settings changes. */
  init() {
    let last = '';
    appStore.subscribe(() => {
      const list = appStore.get().settings.mcpServers;
      const key = list.map(fingerprint).join('\n');
      if (key === last) return;
      last = key;
      void this.refreshAll();
    });
  }

  private setStatus(id: string, st: McpStatus | null) {
    mcpStore.set((s) => {
      const status = { ...s.status };
      if (st) status[id] = st;
      else delete status[id];
      return { status };
    });
  }

  refresh(cfg: McpServerConfig): Promise<void> {
    if (!cfg.enabled || !cfg.url.trim()) {
      this.tools.delete(cfg.id);
      this.skillList.delete(cfg.id);
      this.prints.delete(cfg.id);
      this.setStatus(cfg.id, null);
      return Promise.resolve();
    }
    const print = fingerprint(cfg);
    const running = this.loading.get(cfg.id);
    if (running && this.prints.get(cfg.id) === print) return running;
    if (this.prints.get(cfg.id) === print && mcpStore.get().status[cfg.id]?.state === 'ready') return Promise.resolve();

    this.prints.set(cfg.id, print);
    this.setStatus(cfg.id, { state: 'connecting', tools: [] });
    const job = (async () => {
      try {
        const client = new McpClient(cfg, post);
        const infos = await client.listTools();
        const tools = infos.map((i) => adaptTool(cfg, client, i));
        this.tools.set(cfg.id, tools);
        this.skillList.set(cfg.id, serverSkill(cfg, tools));
        this.setStatus(cfg.id, { state: 'ready', tools: infos.map((i) => i.name), serverName: client.serverName });
        log.info('mcp', `${cfg.name}: ${infos.length} tools (${infos.map((i) => i.name).join(', ')})`);
      } catch (e: any) {
        this.tools.delete(cfg.id);
        this.skillList.delete(cfg.id);
        this.prints.delete(cfg.id); // try again next time
        this.setStatus(cfg.id, { state: 'error', tools: [], error: String(e?.message ?? e) });
        log.warn('mcp', `${cfg.name}: ${stringify(e)}`);
      } finally {
        this.loading.delete(cfg.id);
      }
    })();
    this.loading.set(cfg.id, job);
    return job;
  }

  async refreshAll(): Promise<void> {
    const list = appStore.get().settings.mcpServers;
    const ids = new Set(list.map((c) => c.id));
    for (const id of [...this.tools.keys()]) {
      if (!ids.has(id)) {
        this.tools.delete(id);
        this.skillList.delete(id);
        this.prints.delete(id);
        this.setStatus(id, null);
      }
    }
    await Promise.all(list.map((c) => this.refresh(c)));
  }

  /** Waits (briefly) for servers that are still connecting, so a task started right after launch sees their tools. */
  async ensureLoaded(timeoutMs = 8000): Promise<void> {
    const pending = [...this.loading.values()];
    if (!pending.length) {
      // servers that have never been tried (or failed earlier) get one more go
      const todo = appStore.get().settings.mcpServers.filter((c) => c.enabled && !this.tools.has(c.id));
      if (!todo.length) return;
      pending.push(...todo.map((c) => this.refresh(c)));
    }
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  allTools(): Tool[] {
    return [...this.tools.values()].flat();
  }

  skills(): Skill[] {
    return [...this.skillList.values()];
  }

  /** "Test connection" in the setup screen: connect once and report. Does not keep the client. */
  async test(cfg: McpServerConfig): Promise<{ ok: boolean; tools: string[]; error?: string }> {
    try {
      const infos = await new McpClient(cfg, post).listTools();
      return { ok: true, tools: infos.map((i) => i.name) };
    } catch (e: any) {
      return { ok: false, tools: [], error: String(e?.message ?? e) };
    }
  }
}

export const mcp = new McpManager();
