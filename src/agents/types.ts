export interface ToolCall {
  id: string;
  name: string;
  /** raw JSON string, as the model produced it */
  arguments: string;
}

export type AgentMsg =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type TaskStatus =
  | 'scheduled' // waiting for its start time
  | 'queued'
  | 'running'
  | 'waiting' // needs an answer from the user
  | 'blocked' // waiting for teammates it delegated to
  | 'done'
  | 'failed'
  | 'cancelled';

export interface Step {
  t: number;
  kind: 'tool' | 'result' | 'ask' | 'delegate' | 'info' | 'error';
  title: string;
  detail?: string;
}

/** A tool call that cannot be answered yet. */
export interface Pending {
  callId: string;
  kind: 'ask' | 'child';
  childId?: string;
  question?: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  goal: string;
  status: TaskStatus;
  messages: AgentMsg[];
  steps: Step[];
  pending: Pending[];
  stepCount: number;
  result?: string;
  error?: string;
  parentId?: string;
  depth: number;
  /** start no earlier than this */
  runAt?: number;
  /** re-run on this interval after finishing */
  everyMinutes?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  /** one line describing what this teammate is for; also becomes part of its prompt */
  role: string;
  builtin?: boolean;
}

export interface Note {
  id: string;
  text: string;
  t: number;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** tools that touch the internet; hidden when the user switches web access off */
  web?: boolean;
  run(args: Record<string, any>): Promise<string>;
}

export const MAX_DELEGATION_DEPTH = 2;
