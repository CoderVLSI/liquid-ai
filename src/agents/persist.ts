import type { Agent, AgentTask, Note } from './types.ts';

export interface SavedAgents {
  agents: Agent[];
  tasks: AgentTask[];
  notes: Note[];
}

/** The built-in team. Atlas coordinates; the others are specialists it can hand work to. */
export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    emoji: '🧭',
    role: 'You are the generalist and coordinator: plan the work, do simple parts yourself and hand research or note-keeping to teammates when it helps.',
    builtin: true,
  },
  {
    id: 'scout',
    name: 'Scout',
    emoji: '🔎',
    role: 'You are the researcher: search the web, read pages and report concise, sourced findings.',
    builtin: true,
  },
  {
    id: 'scribe',
    name: 'Scribe',
    emoji: '🗒️',
    role: 'You keep the notebook: save, find and organise notes and set reminders, and you write clean summaries.',
    builtin: true,
  },
];

const MAX_TASKS = 60;

/** What goes to disk: finished tasks drop their (large) message history, old ones are pruned. */
export function serialize(s: SavedAgents): string {
  const finished = new Set(['done', 'failed', 'cancelled']);
  const tasks = s.tasks
    .slice(-MAX_TASKS)
    .map((t) => (finished.has(t.status) ? { ...t, messages: [] } : t));
  return JSON.stringify({ v: 1, agents: s.agents, tasks, notes: s.notes.slice(-300) });
}

/** Reads the saved file; tasks that were running when the app died are put back in the queue. */
export function deserialize(raw: string | null): SavedAgents {
  const empty = { agents: DEFAULT_AGENTS, tasks: [] as AgentTask[], notes: [] as Note[] };
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw);
    const saved: Agent[] = Array.isArray(j.agents) ? j.agents.filter((a: any) => a && a.id && a.name) : [];
    // built-ins always exist; the user's custom teammates are kept
    const custom = saved.filter((a) => !DEFAULT_AGENTS.some((d) => d.id === a.id));
    const tasks: AgentTask[] = (Array.isArray(j.tasks) ? j.tasks : []).map((t: AgentTask) => ({
      ...t,
      messages: t.messages ?? [],
      steps: t.steps ?? [],
      pending: t.pending ?? [],
      status: t.status === 'running' ? 'queued' : t.status,
    }));
    return { agents: [...DEFAULT_AGENTS, ...custom], tasks, notes: Array.isArray(j.notes) ? j.notes : [] };
  } catch {
    return empty;
  }
}
