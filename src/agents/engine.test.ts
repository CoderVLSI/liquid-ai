import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask, resolvePending, toolSchemas } from './engine.ts';
import type { EngineDeps, LlmClient, LlmResponse } from './engine.ts';
import type { Agent, AgentTask, Tool } from './types.ts';
import { buildTools } from './tools.ts';
import type { ToolDeps } from './tools.ts';

const atlas: Agent = { id: 'atlas', name: 'Atlas', emoji: '🧭', role: 'Generalist.' };
const scout: Agent = { id: 'scout', name: 'Scout', emoji: '🔎', role: 'Researcher.' };

const call = (name: string, args: unknown, id = `c_${name}`) => ({ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const say = (content: string): LlmResponse => ({ content, toolCalls: [], finish: 'stop' });
const use = (...calls: ReturnType<typeof call>[]): LlmResponse => ({ content: '', toolCalls: calls, finish: 'tool_calls' });

class ScriptedLlm implements LlmClient {
  requests: { system: string; messages: any[]; tools: any }[] = [];
  script: (LlmResponse | Error)[];
  constructor(script: (LlmResponse | Error)[]) {
    this.script = script;
  }
  async chat(req: any): Promise<LlmResponse> {
    this.requests.push({ system: req.system, messages: [...req.messages], tools: req.tools });
    const next = this.script.shift();
    if (!next) throw new Error('script exhausted');
    if (next instanceof Error) throw next;
    return next;
  }
}

const newTask = (over: Partial<AgentTask> = {}): AgentTask => ({
  id: 't1', agentId: 'atlas', goal: 'do it', status: 'running', messages: [], steps: [], pending: [], stepCount: 0, depth: 0, createdAt: 0, updatedAt: 0, ...over,
});

const NOW = new Date(2026, 9, 29, 14, 30);

function setup(script: (LlmResponse | Error)[], extra: Partial<EngineDeps> = {}, tools: Tool[] = []) {
  const llm = new ScriptedLlm(script);
  const spawned: { agent: string; goal: string }[] = [];
  const updates: Partial<AgentTask>[] = [];
  const deps: EngineDeps = {
    llm, tools, agent: atlas, team: [atlas, scout], now: () => NOW, onUpdate: (p) => updates.push(p),
    spawnChild: (agent, goal) => { if (agent.toLowerCase() !== 'scout') return null; spawned.push({ agent, goal }); return 'child1'; },
    ...extra,
  };
  return { llm, deps, spawned, updates };
}

const echo: Tool = { name: 'echo', description: 'echo', parameters: { type: 'object', properties: { text: { type: 'string' } } }, async run(a) { return `echo:${a.text}`; } };

test('answers directly when no tool is needed', async () => {
  const { deps, llm } = setup([say('  42  ')]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  assert.equal(r.result, '42');
  assert.match(llm.requests[0].system, /You are Atlas/);
  assert.match(llm.requests[0].system, /Thursday 2026-10-29 14:30/);
});

test('runs a tool, feeds the result back, then finishes', async () => {
  const { deps, llm } = setup([use(call('echo', { text: 'hi' }, 'a')), say('done: echo:hi')], {}, [echo]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  const second = llm.requests[1].messages;
  assert.equal(second[1].role, 'assistant');
  assert.equal(second[1].tool_calls[0].id, 'a');
  assert.deepEqual(second[2], { role: 'tool', tool_call_id: 'a', content: 'echo:hi' });
  assert.ok(r.steps!.some((s) => s.kind === 'tool' && s.title.startsWith('echo(')));
});

test('unknown tools and bad JSON arguments are reported back to the model, not crashes', async () => {
  const { deps, llm } = setup([use(call('nope', {}, 'x'), call('echo', '{not json', 'y')), say('ok')], {}, [echo]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  const tools = llm.requests[1].messages.filter((m: any) => m.role === 'tool');
  assert.match(tools[0].content, /unknown tool "nope"/);
  assert.match(tools[1].content, /not valid JSON/);
});

test('a tool that throws becomes an error message the model can react to', async () => {
  const boom: Tool = { name: 'boom', description: '', parameters: {}, async run() { throw new Error('disk on fire'); } };
  const { deps, llm } = setup([use(call('boom', {}, 'b')), say('handled')], {}, [boom]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  assert.match(llm.requests[1].messages.find((m: any) => m.role === 'tool').content, /Error: disk on fire/);
});

test('a model stuck repeating the same call is told to stop', async () => {
  const same = () => use(call('echo', { text: 'x' }, `i${Math.random()}`));
  const { deps, llm } = setup([same(), same(), same(), say('fine, done')], {}, [echo]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  const toolMsgs = llm.requests[3].messages.filter((m: any) => m.role === 'tool');
  assert.match(toolMsgs[2].content, /already made this exact call twice/);
});

test('ask_user pauses the task, and the answer resumes it', async () => {
  const { deps, llm } = setup([use(call('ask_user', { question: 'Which city?' }, 'q1'))]);
  const first = await runTask(newTask(), deps);
  assert.equal(first.status, 'waiting');
  assert.deepEqual(first.pending, [{ callId: 'q1', kind: 'ask', question: 'Which city?' }]);

  const resumed = { ...newTask(), ...first, ...resolvePending({ ...newTask(), ...first } as AgentTask, 'q1', 'Paris') } as AgentTask;
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.pending.length, 0);

  const llm2 = new ScriptedLlm([say('It is sunny in Paris.')]);
  const second = await runTask(resumed, { ...deps, llm: llm2 });
  assert.equal(second.status, 'done');
  const last = llm2.requests[0].messages.at(-1);
  assert.deepEqual(last, { role: 'tool', tool_call_id: 'q1', content: 'Paris' });
  void llm;
});

test('delegate_task blocks the parent on a child, whose result resumes it', async () => {
  const { deps, spawned } = setup([use(call('delegate_task', { agent: 'Scout', goal: 'find x' }, 'd1'))]);
  const first = await runTask(newTask(), deps);
  assert.equal(first.status, 'blocked');
  assert.deepEqual(spawned, [{ agent: 'Scout', goal: 'find x' }]);
  assert.deepEqual(first.pending, [{ callId: 'd1', kind: 'child', childId: 'child1' }]);

  const r = resolvePending({ ...newTask(), ...first } as AgentTask, 'd1', 'x is 7');
  assert.equal(r.status, 'queued');
});

test('delegating to someone who does not exist is an error the model can fix', async () => {
  const { deps, llm } = setup([use(call('delegate_task', { agent: 'Ghost', goal: 'boo' }, 'd')), say('did it myself')]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  assert.match(llm.requests[1].messages.at(-1).content, /no teammate called "Ghost"/);
});

test('delegation is not offered to deeply nested tasks', async () => {
  const { deps, llm } = setup([say('ok')]);
  await runTask(newTask({ depth: 2 }), deps);
  const names = llm.requests[0].tools.map((t: any) => t.function.name);
  assert.ok(!names.includes('delegate_task'));
  assert.ok(names.includes('ask_user'));
  assert.ok(!llm.requests[0].system.includes('Teammates you can hand work to'));
  assert.ok(toolSchemas([], true).some((t) => t.function.name === 'delegate_task'));
});

test('hitting the step limit forces a final answer instead of failing', async () => {
  const many = Array.from({ length: 3 }, (_, i) => use(call('echo', { text: String(i) }, `s${i}`)));
  const { deps, llm } = setup([...many, say('best effort')], { maxSteps: 3 }, [echo]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'done');
  assert.equal(r.result, 'best effort');
  assert.equal(llm.requests.at(-1)!.tools, null);
  assert.match(llm.requests.at(-1)!.messages.at(-1).content, /Step limit reached/);
});

test('model errors fail the task with the reason', async () => {
  const { deps } = setup([new Error('server returned HTTP 500')]);
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'failed');
  assert.match(r.error!, /HTTP 500/);
  assert.ok(r.steps!.some((s) => s.kind === 'error'));
});

test('an aborted run reports cancelled instead of failed', async () => {
  const ctl = new AbortController();
  const llm: LlmClient = { async chat() { ctl.abort(); throw new Error('aborted'); } };
  const { deps } = setup([], { llm, signal: ctl.signal });
  const r = await runTask(newTask(), deps);
  assert.equal(r.status, 'cancelled');
});

test('a task resumed from saved messages continues instead of starting over', async () => {
  const saved = newTask({ messages: [{ role: 'user', content: 'do it' }, { role: 'assistant', content: 'working on it' }], stepCount: 1 });
  const { deps, llm } = setup([say('finished')]);
  const r = await runTask(saved, deps);
  assert.equal(r.status, 'done');
  assert.equal(llm.requests[0].messages.length, 2);
});

// ---- the real tools ---------------------------------------------------------------------------

function realTools(over: Partial<ToolDeps> = {}) {
  const notes: { id: string; text: string; t: number }[] = [];
  const reminders: { at: number; text: string }[] = [];
  const tools = buildTools({
    now: () => NOW,
    fetchText: async () => ({ status: 200, text: '', contentType: 'text/html' }),
    notes: {
      add: (text) => { const n = { id: `n${notes.length + 1}`, text, t: NOW.getTime() }; notes.push(n); return n; },
      list: () => notes,
      remove: (id) => { const i = notes.findIndex((n) => n.id === id); if (i < 0) return false; notes.splice(i, 1); return true; },
    },
    scheduleReminder: (at, text) => { reminders.push({ at, text }); return 1; },
    ...over,
  });
  const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args);
  return { tools, run, notes, reminders };
}

test('calculator tool is exact and safe', async () => {
  const { run } = realTools();
  assert.equal(await run('calculator', { expression: '(12.5 * 4) / 3' }), '(12.5 * 4) / 3 = 16.6666666667');
  assert.match(await run('calculator', { expression: 'process.exit()' }), /^Error/);
});

test('notes can be saved, searched and deleted', async () => {
  const { run } = realTools();
  await run('save_note', { text: 'buy milk' });
  await run('save_note', { text: 'call mum' });
  assert.match(await run('list_notes', { query: 'milk' }), /buy milk/);
  assert.doesNotMatch(await run('list_notes', { query: 'milk' }), /call mum/);
  assert.equal(await run('delete_note', { id: 'n1' }), 'Deleted.');
  assert.match(await run('list_notes', {}), /call mum/);
});

test('reminders accept minutes or a date-time and reject the past', async () => {
  const { run, reminders } = realTools();
  assert.match(await run('set_reminder', { text: 'tea', minutes: '10' }), /Reminder set/);
  assert.equal(reminders[0].at, NOW.getTime() + 10 * 60_000);
  assert.match(await run('set_reminder', { text: 'meeting', at: '2026-10-30T09:00' }), /Friday 2026-10-30 09:00/);
  assert.match(await run('set_reminder', { text: 'x', at: '2020-01-01T00:00' }), /in the past/);
  assert.match(await run('set_reminder', { text: 'x' }), /give "minutes"/);
});

test('web_search falls back to Wikipedia when the first engine returns nothing', async () => {
  const seen: string[] = [];
  const { run } = realTools({
    fetchText: async (url) => {
      seen.push(url);
      if (url.includes('duckduckgo')) return { status: 200, text: '<html></html>', contentType: 'text/html' };
      return { status: 200, text: JSON.stringify({ query: { search: [{ title: 'Liquid neural network', snippet: 'A <span>kind</span> of model' }] } }), contentType: 'application/json' };
    },
  });
  const out = await run('web_search', { query: 'liquid neural' });
  assert.equal(seen.length, 2);
  assert.match(out, /Liquid neural network/);
  assert.match(out, /en\.wikipedia\.org\/wiki\/Liquid_neural_network/);
});

test('fetch_url validates the url and returns readable text', async () => {
  const { run } = realTools({ fetchText: async () => ({ status: 200, text: '<html><body><h1>Hi</h1><script>x()</script><p>there</p></body></html>', contentType: 'text/html' }) });
  assert.match(await run('fetch_url', { url: 'file:///etc/passwd' }), /must start with http/);
  const out = await run('fetch_url', { url: 'https://example.com' });
  assert.match(out, /Hi/);
  assert.doesNotMatch(out, /x\(\)/);
});
