import type { Agent, AgentMsg, AgentTask, Pending, Step, Tool, ToolCall, ToolSchema } from './types.ts';
import { MAX_DELEGATION_DEPTH } from './types.ts';
import { formatDateTime } from './tools.ts';

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
  finish: string;
}

export interface LlmClient {
  chat(req: {
    system: string;
    messages: AgentMsg[];
    tools: ToolSchema[] | null;
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}

export interface EngineDeps {
  llm: LlmClient;
  tools: Tool[];
  agent: Agent;
  /** every teammate, so this one can delegate */
  team: Agent[];
  /** creates a sub-task for a teammate; returns its id, or null if not possible */
  spawnChild: (agentName: string, goal: string) => string | null;
  now: () => Date;
  signal?: AbortSignal;
  maxSteps?: number;
  /** ask the user before any tool that has an `approval` description runs */
  requireApproval?: boolean;
  /** live progress (UI + persistence); the returned patch of runTask is the final one */
  onUpdate: (patch: Partial<AgentTask>) => void;
}

const MAX_TOOL_OUTPUT = 3000;

export function systemPrompt(agent: Agent, team: Agent[], now: Date, depth: number): string {
  const mates = team.filter((a) => a.id !== agent.id);
  const lines = [
    `You are ${agent.name}, an autonomous assistant running privately on the user's phone. ${agent.role}`,
    `Current time: ${formatDateTime(now)}.`,
    'You work on one task at a time. Use the tools when they help; do not guess facts you can look up or compute.',
    'Call a tool only when needed, then continue from its result. When the task is complete, reply with the final result and no tool call.',
    'Keep final answers short and concrete. If you need a decision or missing information from the user, call ask_user instead of guessing.',
  ];
  if (mates.length && depth < MAX_DELEGATION_DEPTH) {
    lines.push(`Teammates you can hand work to with delegate_task: ${mates.map((m) => `${m.name} (${m.role})`).join('; ')}.`);
    lines.push('Independent sub-tasks can be delegated in the same turn (several delegate_task calls at once): your teammates work on them in parallel, so split big jobs instead of doing them one by one.');
  }
  return lines.join('\n');
}

const ASK: ToolSchema = {
  type: 'function',
  function: {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their answer. Use only when you truly cannot continue without it.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
};

const DELEGATE: ToolSchema = {
  type: 'function',
  function: {
    name: 'delegate_task',
    description: 'Hand a self-contained sub-task to a teammate. You will receive their result.',
    parameters: {
      type: 'object',
      properties: { agent: { type: 'string', description: 'teammate name' }, goal: { type: 'string', description: 'what they should do, with all needed context' } },
      required: ['agent', 'goal'],
    },
  },
};

export function toolSchemas(tools: Tool[], canDelegate: boolean): ToolSchema[] {
  const list: ToolSchema[] = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  list.push(ASK);
  if (canDelegate) list.push(DELEGATE);
  return list;
}

const clip = (s: string, n = MAX_TOOL_OUTPUT) => (s.length > n ? s.slice(0, n) + `\n…[${s.length - n} more characters cut]` : s);

function parseArgs(raw: string): { ok: true; args: Record<string, any> } | { ok: false; error: string } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, args: {} };
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, args: v } : { ok: false, error: 'arguments must be a JSON object' };
  } catch {
    return { ok: false, error: 'arguments were not valid JSON' };
  }
}

/**
 * Runs (or resumes) one task until it finishes, needs the user, or waits for teammates.
 * Everything the model said and every tool result lives in task.messages, so a task that was
 * interrupted by an app restart continues from where it stopped.
 */
export async function runTask(task: AgentTask, deps: EngineDeps): Promise<Partial<AgentTask>> {
  const maxSteps = deps.maxSteps ?? 10;
  const messages: AgentMsg[] = task.messages.length ? [...task.messages] : [{ role: 'user', content: task.goal }];
  const steps: Step[] = [...task.steps];
  let stepCount = task.stepCount;
  const canDelegate = task.depth < MAX_DELEGATION_DEPTH && deps.team.some((a) => a.id !== deps.agent.id);
  const schemas = toolSchemas(deps.tools, canDelegate);
  const byName = new Map(deps.tools.map((t) => [t.name, t]));
  const seen = new Map<string, number>();

  const push = (s: Omit<Step, 't'>) => steps.push({ ...s, t: deps.now().getTime() });
  const sync = () => deps.onUpdate({ messages: [...messages], steps: [...steps], stepCount });
  const system = () => systemPrompt(deps.agent, deps.team, deps.now(), task.depth);

  try {
    while (stepCount < maxSteps) {
      if (deps.signal?.aborted) return { status: 'cancelled', messages, steps, stepCount };
      const res = await deps.llm.chat({ system: system(), messages, tools: schemas, signal: deps.signal });
      stepCount++;

      if (!res.toolCalls.length) {
        const answer = res.content.trim() || '(no answer)';
        messages.push({ role: 'assistant', content: answer });
        push({ kind: 'result', title: 'Finished', detail: answer });
        return { status: 'done', result: answer, messages, steps, stepCount, pending: [], error: undefined };
      }

      messages.push({
        role: 'assistant',
        content: res.content ?? '',
        tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments || '{}' } })),
      });
      if (res.content?.trim()) push({ kind: 'info', title: 'Thinking', detail: res.content.trim() });

      const pending: Pending[] = [];
      for (const call of res.toolCalls) {
        const parsed = parseArgs(call.arguments);
        const sig = `${call.name}:${call.arguments}`;
        const times = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, times);

        const reply = (content: string) => messages.push({ role: 'tool', tool_call_id: call.id, content });

        if (!parsed.ok) {
          reply(`Error: ${parsed.error}. Call ${call.name} again with a valid JSON object.`);
          push({ kind: 'error', title: `${call.name}: bad arguments`, detail: call.arguments });
          continue;
        }
        if (times > 2) {
          reply('You have already made this exact call twice. Do not repeat it; use what you have and give your final answer.');
          push({ kind: 'info', title: `Repeated ${call.name} call skipped` });
          continue;
        }

        if (call.name === 'ask_user') {
          const question = String(parsed.args.question ?? '').trim() || 'I need your input to continue.';
          push({ kind: 'ask', title: 'Asked you', detail: question });
          pending.push({ callId: call.id, kind: 'ask', question });
          continue;
        }

        if (call.name === 'delegate_task') {
          const target = String(parsed.args.agent ?? '').trim();
          const goal = String(parsed.args.goal ?? '').trim();
          if (!canDelegate || !goal) {
            reply(canDelegate ? 'Error: give a goal for the teammate.' : 'Error: delegation is not available here. Do the work yourself.');
            continue;
          }
          const childId = deps.spawnChild(target, goal);
          if (!childId) {
            reply(`Error: no teammate called "${target}". Available: ${deps.team.filter((a) => a.id !== deps.agent.id).map((a) => a.name).join(', ')}.`);
            push({ kind: 'error', title: `No teammate "${target}"` });
            continue;
          }
          push({ kind: 'delegate', title: `Handed to ${target}`, detail: goal });
          pending.push({ callId: call.id, kind: 'child', childId });
          continue;
        }

        const tool = byName.get(call.name);
        if (!tool) {
          reply(`Error: unknown tool "${call.name}". Available tools: ${[...byName.keys(), 'ask_user'].join(', ')}.`);
          push({ kind: 'error', title: `Unknown tool ${call.name}` });
          continue;
        }

        if (tool.approval && deps.requireApproval) {
          const question = tool.approval(parsed.args);
          push({ kind: 'ask', title: 'Needs your approval', detail: question });
          pending.push({ callId: call.id, kind: 'approve', question, tool: call.name, args: parsed.args });
          continue;
        }

        let out: string;
        try {
          out = clip(String(await tool.run(parsed.args)));
        } catch (e: any) {
          out = `Error: ${e?.message ?? e}`;
        }
        reply(out);
        push({ kind: 'tool', title: `${call.name}(${summarizeArgs(parsed.args)})`, detail: out });
      }

      sync();
      if (pending.length) {
        const needsUser = pending.some((p) => p.kind === 'ask' || p.kind === 'approve');
        return {
          status: needsUser ? 'waiting' : 'blocked',
          pending,
          messages,
          steps,
          stepCount,
        };
      }
    }

    // out of steps: make the model wrap up with what it has instead of failing
    messages.push({ role: 'user', content: 'Step limit reached. Give your best final answer now using what you have found. Do not call tools.' });
    const res = await deps.llm.chat({ system: system(), messages, tools: null, signal: deps.signal });
    const answer = res.content.trim() || '(no answer)';
    messages.push({ role: 'assistant', content: answer });
    push({ kind: 'result', title: 'Finished (step limit)', detail: answer });
    return { status: 'done', result: answer, messages, steps, stepCount: stepCount + 1, pending: [] };
  } catch (e: any) {
    if (deps.signal?.aborted) return { status: 'cancelled', messages, steps, stepCount };
    push({ kind: 'error', title: 'Stopped by an error', detail: String(e?.message ?? e) });
    return { status: 'failed', error: String(e?.message ?? e), messages, steps, stepCount };
  }
}

function summarizeArgs(a: Record<string, any>): string {
  const s = Object.entries(a)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v) : JSON.stringify(v)}`)
    .join(', ');
  return s.length > 90 ? s.slice(0, 90) + '…' : s;
}

/** Feeds an answer (from the user or a finished teammate) into the call that was waiting for it. */
export function resolvePending(task: AgentTask, callId: string, content: string): Partial<AgentTask> {
  const pending = task.pending.filter((p) => p.callId !== callId);
  const messages: AgentMsg[] = [...task.messages, { role: 'tool', tool_call_id: callId, content: clip(content) }];
  return {
    pending,
    messages,
    status: pending.length ? (pending.some((p) => p.kind === 'ask' || p.kind === 'approve') ? 'waiting' : 'blocked') : 'queued',
  };
}
