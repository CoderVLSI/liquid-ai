import { createStore } from '../state/store';
import { DEFAULT_AGENTS } from './persist';
import type { Agent, AgentTask, Note, Reminder, Todo } from './types';

export interface AgentState {
  loaded: boolean;
  agents: Agent[];
  tasks: AgentTask[];
  notes: Note[];
  reminders: Reminder[];
  todos: Todo[];
}

export const agentStore = createStore<AgentState>({
  loaded: false,
  agents: DEFAULT_AGENTS,
  tasks: [],
  notes: [],
  reminders: [],
  todos: [],
});
