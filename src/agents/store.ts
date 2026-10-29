import { createStore } from '../state/store';
import { DEFAULT_AGENTS } from './persist';
import type { Agent, AgentTask, Note } from './types';

export interface AgentState {
  loaded: boolean;
  agents: Agent[];
  tasks: AgentTask[];
  notes: Note[];
}

export const agentStore = createStore<AgentState>({
  loaded: false,
  agents: DEFAULT_AGENTS,
  tasks: [],
  notes: [],
});
