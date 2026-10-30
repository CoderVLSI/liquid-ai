import { native } from '../native';
import { ensureNotificationPermission, inBackground, refreshBackground, registerBackgroundSource } from '../lib/background';
import { log, stringify } from '../lib/log';
import { appStore } from '../state/app';
import { downloads } from '../models/downloads';
import { server } from '../server/ServerManager';
import type { ModelId } from '../models/catalog';
import { agentStore } from './store';
import { deserialize, serialize } from './persist';
import { runTask, resolvePending } from './engine';
import { buildTools } from './tools';
import { personaLine } from '../state/profile';
import { mcp } from '../mcp/manager';
import { ServerLlm } from './llm';
import { connectionTools } from '../connections/store';
import type { Agent, AgentTask, Note, Reminder, Todo, Tool } from './types';

let started = false;
let pumping = false;
/** tasks that are executing right now (the swarm) */
const running = new Map<string, AbortController>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let uid = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

const file = () => `${native.info().filesDir}/agents.json`;

// ---- persistence + state helpers -------------------------------------------------------------

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const { agents, tasks, notes, reminders, todos } = agentStore.get();
      native.writeText(file(), serialize({ agents, tasks, notes, reminders, todos }), false);
    } catch (e) {
      log.warn('agents', 'save failed', stringify(e));
    }
  }, 800);
}

const find = (id: string) => agentStore.get().tasks.find((t) => t.id === id);

function setTasks(fn: (t: AgentTask[]) => AgentTask[]) {
  agentStore.set((s) => ({ tasks: fn(s.tasks) }));
  persistSoon();
  updateKeepAlive();
}

function patchTask(id: string, patch: Partial<AgentTask>) {
  setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)));
}

const ACTIVE = new Set(['queued', 'running', 'scheduled', 'blocked']);

function updateKeepAlive() {
  refreshBackground();
}

function backgroundText(): string | null {
  const tasks = agentStore.get().tasks;
  const n = tasks.filter((t) => ACTIVE.has(t.status)).length;
  if (!n) return null;
  const working = running.size;
  return working > 1 ? `${working} agents working · ${n} task${n > 1 ? 's' : ''}` : `${n} agent task${n > 1 ? 's' : ''}`;
}

function notifyId(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 5000 + (Math.abs(h) % 100000);
}

// ---- notes (used by the notebook tools) ------------------------------------------------------

export const notesApi = {
  add(text: string): Note {
    const n: Note = { id: newId('n'), text, t: Date.now() };
    agentStore.set((s) => ({ notes: [...s.notes, n] }));
    persistSoon();
    return n;
  },
  list: (): Note[] => agentStore.get().notes,
  remove(id: string): boolean {
    const before = agentStore.get().notes.length;
    agentStore.set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    persistSoon();
    return agentStore.get().notes.length < before;
  },
};

// ---- reminders and to-dos (used by the reminder / to-do tools) --------------------------------

export const remindersApi = {
  add(id: number, at: number, text: string) {
    const now = Date.now();
    agentStore.set((s) => ({ reminders: [...s.reminders.filter((r) => r.at > now), { id, at, text }] }));
    persistSoon();
  },
  list: (): Reminder[] => agentStore.get().reminders,
  cancel(id: number): boolean {
    const had = agentStore.get().reminders.some((r) => r.id === id);
    if (had) {
      try {
        native.cancelReminder(id);
      } catch (e) {
        log.warn('agents', 'cancelReminder failed', stringify(e));
      }
      agentStore.set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) }));
      persistSoon();
    }
    return had;
  },
};

export const todosApi = {
  add(text: string): Todo {
    const t: Todo = { id: newId('d'), text, done: false, t: Date.now() };
    agentStore.set((s) => ({ todos: [...s.todos, t] }));
    persistSoon();
    return t;
  },
  list: (): Todo[] => agentStore.get().todos,
  complete(idOrText: string): Todo | null {
    const q = idOrText.trim().toLowerCase();
    const open = agentStore.get().todos.filter((t) => !t.done);
    const hit = open.find((t) => t.id.toLowerCase() === q) ?? open.find((t) => t.text.toLowerCase().includes(q)) ?? open.find((t) => q.includes(t.text.toLowerCase()));
    if (!hit) return null;
    agentStore.set((s) => ({ todos: s.todos.map((t) => (t.id === hit.id ? { ...t, done: true } : t)) }));
    persistSoon();
    return hit;
  },
};

async function fetchText(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, signal: ctl.signal });
    const text = (await r.text()).slice(0, 1_500_000);
    return { status: r.status, text, contentType: r.headers.get('content-type') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

// ---- public API ------------------------------------------------------------------------------

export async function startAgents() {
  if (started) return;
  started = true;
  try {
    const raw = await native.readText(file());
    const saved = deserialize(raw);
    agentStore.set({ ...saved, loaded: true });
  } catch (e) {
    log.warn('agents', 'load failed', stringify(e));
    agentStore.set({ loaded: true });
  }
  registerBackgroundSource('agents', backgroundText);
  updateKeepAlive();
  setInterval(() => void pump(), 15_000);
  void pump();
}

export function enqueue(o: { agentId: string; goal: string; runAt?: number; everyMinutes?: number; parentId?: string; depth?: number }): string {
  const now = Date.now();
  const later = o.runAt != null && o.runAt > now + 2000;
  const task: AgentTask = {
    id: newId('t'),
    agentId: o.agentId,
    goal: o.goal.trim(),
    status: later ? 'scheduled' : 'queued',
    messages: [],
    steps: [],
    pending: [],
    stepCount: 0,
    parentId: o.parentId,
    depth: o.depth ?? 0,
    runAt: later ? o.runAt : undefined,
    everyMinutes: o.everyMinutes,
    createdAt: now,
    updatedAt: now,
  };
  setTasks((ts) => [...ts, task]);
  if (!o.parentId) void ensureNotificationPermission();
  log.info('agents', `task ${task.id} for ${o.agentId}: ${task.goal.slice(0, 80)}`);
  void pump();
  return task.id;
}

export function answerTask(id: string, text: string) {
  const t = find(id);
  if (!t || t.status !== 'waiting') return;
  const p = t.pending.find((x) => x.kind === 'ask');
  if (!p) return;
  const patch = resolvePending(t, p.callId, text);
  patchTask(id, {
    ...patch,
    steps: [...t.steps, { t: Date.now(), kind: 'info', title: 'You answered', detail: text }],
  });
  void pump();
}

export function cancelTask(id: string) {
  const t = find(id);
  if (!t || ['done', 'failed', 'cancelled'].includes(t.status)) return;
  running.get(id)?.abort();
  patchTask(id, { status: 'cancelled', pending: [] });
  for (const c of agentStore.get().tasks.filter((x) => x.parentId === id)) cancelTask(c.id);
  const after = find(id);
  if (after?.parentId) resolveParent(after);
  updateKeepAlive();
}

export function retryTask(id: string) {
  const t = find(id);
  if (!t || !['failed', 'cancelled', 'done'].includes(t.status)) return;
  patchTask(id, { status: 'queued', messages: [], steps: [], pending: [], stepCount: 0, result: undefined, error: undefined });
  void pump();
}

export function removeTask(id: string) {
  cancelTask(id);
  setTasks((ts) => ts.filter((t) => t.id !== id && t.parentId !== id));
}

export function clearFinished() {
  setTasks((ts) => ts.filter((t) => ACTIVE.has(t.status) || t.status === 'waiting'));
}

/** The user renamed their assistant in setup: the main agent carries that name everywhere. */
export function renameMainAgent(name: string) {
  const n = name.trim();
  if (!n) return;
  agentStore.set((st) => ({ agents: st.agents.map((a) => (a.id === 'atlas' ? { ...a, name: n } : a)) }));
  persistSoon();
}

export function addAgent(a: { name: string; emoji: string; role: string }): Agent | null {
  const name = a.name.trim();
  if (!name || agentStore.get().agents.some((x) => x.name.toLowerCase() === name.toLowerCase())) return null;
  const agent: Agent = { id: newId('a'), name, emoji: a.emoji.trim() || '🤖', role: a.role.trim() || 'A helpful teammate.' };
  agentStore.set((s) => ({ agents: [...s.agents, agent] }));
  persistSoon();
  return agent;
}

export function removeAgent(id: string) {
  const a = agentStore.get().agents.find((x) => x.id === id);
  if (!a || a.builtin) return;
  agentStore.set((s) => ({ agents: s.agents.filter((x) => x.id !== id) }));
  persistSoon();
}

// ---- execution -------------------------------------------------------------------------------

function pickModel(): ModelId | null {
  if (server.status.state === 'ready' && server.status.modelId) return server.status.modelId; // any LFM3 model can use tools
  const ready = downloads.readyIds();
  if (ready.includes('text')) return 'text';
  const active = appStore.get().settings.activeModel;
  if (active && ready.includes(active)) return active;
  return ready[0] ?? null;
}

function promoteDue() {
  const now = Date.now();
  const due = agentStore.get().tasks.filter((t) => t.status === 'scheduled' && (t.runAt ?? 0) <= now);
  if (due.length) setTasks((ts) => ts.map((t) => (due.some((d) => d.id === t.id) ? { ...t, status: 'queued', runAt: undefined } : t)));
}

/** Starts queued tasks until the swarm is as big as the settings allow. Safe to call any time. */
export function pump() {
  if (pumping) return;
  pumping = true;
  try {
    promoteDue();
    const s = appStore.get();
    if (s.voice.active || s.generating) return; // don't fight a live conversation for the CPU
    const limit = Math.max(1, Math.min(4, s.settings.agentParallel));
    while (running.size < limit) {
      const next = agentStore
        .get()
        .tasks.filter((t) => t.status === 'queued' && !running.has(t.id))
        .sort((a, b) => b.depth - a.depth || a.createdAt - b.createdAt)[0]; // finish sub-tasks first
      if (!next) break;
      const ctl = new AbortController();
      running.set(next.id, ctl);
      patchTask(next.id, { status: 'running', error: undefined }); // synchronously, so it is not picked twice
      void execute(next.id, ctl)
        .catch((e) => {
          log.error('agents', 'runner crashed', stringify(e));
          patchTask(next.id, { status: 'failed', error: String(e?.message ?? e) });
        })
        .finally(() => {
          running.delete(next.id);
          refreshBackground();
          pump();
        });
    }
  } finally {
    pumping = false;
  }
}

/** Everything an agent may use: built-in tools plus whatever the user connected (Slack, Google). */
function toolsFor(agent: Agent, allowWeb: boolean): Tool[] {
  return [
    ...buildTools({
      now: () => new Date(),
      zone: () => appStore.get().settings.timezone,
      fetchText,
      notes: notesApi,
      scheduleReminder: (atMs, text) => {
        const rid = notifyId(newId('r'));
        native.scheduleReminder(rid, atMs, `⏰ ${agent.name}`, text);
        remindersApi.add(rid, atMs, text);
        return rid;
      },
      reminders: remindersApi,
      todos: todosApi,
    }),
    ...connectionTools(() => appStore.get().settings.timezone),
    ...mcp.allTools(),
  ].filter((t) => !t.web || allowWeb);
}

/** The user's decision on a tool that wanted permission (post, send, create…). */
export async function approveTask(id: string, allow: boolean) {
  const t = find(id);
  if (!t || t.status !== 'waiting') return;
  const p = t.pending.find((x) => x.kind === 'approve');
  if (!p) return;
  const agents = agentStore.get().agents;
  const agent = agents.find((a) => a.id === t.agentId) ?? agents[0];
  let content: string;
  if (allow) {
    const tool = toolsFor(agent, appStore.get().settings.agentWeb).find((x) => x.name === p.tool);
    try {
      content = tool ? String(await tool.run(p.args ?? {})) : `Error: the tool ${p.tool} is not available any more.`;
    } catch (e: any) {
      content = `Error: ${e?.message ?? e}`;
    }
  } else {
    content = 'The user denied this action. Do not try it again; continue without it or explain what you could not do.';
  }
  const patch = resolvePending(t, p.callId, content);
  patchTask(id, {
    ...patch,
    steps: [...t.steps, { t: Date.now(), kind: allow ? 'tool' : 'info', title: `${allow ? 'Approved' : 'Denied'}: ${p.tool}`, detail: content }],
  });
  pump();
}

async function execute(id: string, ctl: AbortController) {
  const task = find(id);
  if (!task) return;
  const settings = appStore.get().settings;
  const modelId = pickModel();
  if (!modelId) {
    patchTask(id, { status: 'failed', error: 'No model is downloaded yet. Open Models and download one.' });
    afterRun(id);
    return;
  }

  try {
    await server.ensure(modelId, settings);
  } catch (e: any) {
    patchTask(id, { status: 'failed', error: `Could not start the model: ${e?.message ?? e}` });
    afterRun(id);
    return;
  }

  const agents = agentStore.get().agents;
  const agent = agents.find((a) => a.id === task.agentId) ?? agents[0];
  await mcp.ensureLoaded();
  const tools = toolsFor(agent, settings.agentWeb);

  try {
    const patch = await runTask(find(id) ?? task, {
      llm: new ServerLlm(() => server.baseUrl(settings)),
      tools,
      agent,
      team: agents,
      now: () => new Date(),
      zone: settings.timezone,
      extraSkills: mcp.skills(),
      persona: personaLine(settings),
      signal: ctl.signal,
      maxSteps: settings.agentMaxSteps,
      requireApproval: settings.confirmWrites,
      onUpdate: (p) => patchTask(id, p),
      spawnChild: (name, goal) => {
        const mate = agents.find((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== agent.id);
        if (!mate) return null;
        return enqueue({ agentId: mate.id, goal, parentId: id, depth: task.depth + 1 });
      },
    });
    // a cancel that raced with the run keeps priority
    if (find(id)?.status === 'cancelled') patch.status = 'cancelled';
    patchTask(id, patch);
  } catch (e: any) {
    log.error('agents', 'task crashed', stringify(e));
    patchTask(id, { status: 'failed', error: String(e?.message ?? e) });
  }
  afterRun(id);
}

function resolveParent(child: AgentTask) {
  if (!child.parentId) return;
  const parent = find(child.parentId);
  const p = parent?.pending.find((x) => x.childId === child.id);
  if (!parent || !p) return;
  const content = child.status === 'done' ? child.result ?? '(no result)' : `The teammate could not finish (${child.error ?? child.status}).`;
  patchTask(parent.id, resolvePending(parent, p.callId, content));
}

let taskDoneHook: (() => void) | null = null;
/** called when a task the user gave finishes successfully (the app feeds the buddy XP) */
export function onTaskDone(fn: () => void) {
  taskDoneHook = fn;
}

function afterRun(id: string) {
  const t = find(id);
  if (!t) return;
  const agent = agentStore.get().agents.find((a) => a.id === t.agentId);
  const label = `${agent?.emoji ?? '🤖'} ${agent?.name ?? 'Agent'}`;
  const background = inBackground();

  if (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') {
    if (t.status === 'done' && !t.parentId) taskDoneHook?.();
    if (t.parentId) resolveParent(t);
    else if (background && t.status !== 'cancelled') {
      native.notify(notifyId(t.id), t.status === 'done' ? `${label} finished` : `${label} hit a problem`, (t.result ?? t.error ?? t.goal).slice(0, 300));
    }
    if (t.status === 'done' && t.everyMinutes && !t.parentId) {
      enqueue({ agentId: t.agentId, goal: t.goal, runAt: Date.now() + t.everyMinutes * 60_000, everyMinutes: t.everyMinutes });
    }
  } else if (t.status === 'waiting' && background) {
    native.notify(notifyId(t.id), `${label} needs you`, t.pending.find((p) => p.kind === 'ask' || p.kind === 'approve')?.question ?? t.goal);
  }
}
