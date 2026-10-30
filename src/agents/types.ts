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
  /** ask = question for the user, child = waiting for a teammate, approve = a tool wants permission */
  kind: 'ask' | 'child' | 'approve';
  childId?: string;
  question?: string;
  /** for approve: the tool and arguments that will run if the user allows it */
  tool?: string;
  args?: Record<string, any>;
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
  /** a helper the user never talks to directly: only the main agent hands work to it */
  hidden?: boolean;
}

export interface Note {
  id: string;
  text: string;
  t: number;
}

export interface Reminder {
  id: number;
  /** when it fires, epoch ms */
  at: number;
  text: string;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
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
  /** the tool's own result is a complete answer; after it succeeds the model is told to just confirm in one sentence */
  finishes?: boolean;
  /** tools that change something outside the phone describe the action here; the user must approve it first */
  approval?: (args: Record<string, any>) => string;
  run(args: Record<string, any>): Promise<string>;
}

export const MAX_DELEGATION_DEPTH = 2;
