import type { Agent, AgentTask, Note, Reminder, Todo } from './types.ts';

export interface SavedAgents {
  agents: Agent[];
  tasks: AgentTask[];
  notes: Note[];
  reminders?: Reminder[];
  todos?: Todo[];
}

/** The built-in team. Atlas coordinates; the others are specialists it can hand work to. */
export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'atlas',
    name: 'Pocket',
    emoji: '✨',
    role: 'You are the user\'s personal agent, a friendly assistant mascot.',
    builtin: true,
  },
  {
    id: 'scout',
    name: 'Scout',
    emoji: '🔎',
    role: 'You are a research helper: search the web, read pages and report concise, sourced findings.',
    builtin: true,
    hidden: true,
  },
  {
    id: 'scribe',
    name: 'Scribe',
    emoji: '🗒️',
    role: 'You are a note-keeping helper: save, find and organise notes, set reminders and write clean summaries.',
    builtin: true,
    hidden: true,
  },
];

const MAX_TASKS = 60;

/** What goes to disk: finished tasks drop their (large) message history, old ones are pruned. */
export function serialize(s: SavedAgents): string {
  const finished = new Set(['done', 'failed', 'cancelled']);
  const tasks = s.tasks
    .slice(-MAX_TASKS)
    .map((t) => (finished.has(t.status) ? { ...t, messages: [] } : t));
  return JSON.stringify({ v: 1, agents: s.agents, tasks, notes: s.notes.slice(-300), reminders: (s.reminders ?? []).slice(-100), todos: (s.todos ?? []).slice(-200) });
}

/** Reads the saved file; tasks that were running when the app died are put back in the queue. */
export function deserialize(raw: string | null): SavedAgents {
  const empty = { agents: DEFAULT_AGENTS, tasks: [] as AgentTask[], notes: [] as Note[], reminders: [] as Reminder[], todos: [] as Todo[] };
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
    const mainName = saved.find((a) => a.id === 'atlas')?.name;
    const builtins = DEFAULT_AGENTS.map((d) => (d.id === 'atlas' && mainName ? { ...d, name: mainName } : d));
    return {
      agents: [...builtins, ...custom],
      tasks,
      notes: Array.isArray(j.notes) ? j.notes : [],
      reminders: Array.isArray(j.reminders) ? j.reminders : [],
      todos: Array.isArray(j.todos) ? j.todos : [],
    };
  } catch {
    return empty;
  }
}
