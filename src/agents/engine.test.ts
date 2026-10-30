import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask, resolvePending, toolSchemas } from './engine.ts';
import { pickSkills } from './skills.ts';
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
  const reminders: { id: number; at: number; text: string }[] = [];
  const todos: { id: string; text: string; done: boolean; t: number }[] = [];
  const tools = buildTools({
    now: () => NOW,
    fetchText: async () => ({ status: 200, text: '', contentType: 'text/html' }),
    notes: {
      add: (text) => { const n = { id: `n${notes.length + 1}`, text, t: NOW.getTime() }; notes.push(n); return n; },
      list: () => notes,
      remove: (id) => { const i = notes.findIndex((n) => n.id === id); if (i < 0) return false; notes.splice(i, 1); return true; },
    },
    scheduleReminder: (at, text) => { const id = reminders.length + 1; reminders.push({ id, at, text }); return id; },
    reminders: {
      list: () => reminders,
      cancel: (id) => { const i = reminders.findIndex((r) => r.id === id); if (i < 0) return false; reminders.splice(i, 1); return true; },
    },
    todos: {
      add: (text) => { const t = { id: `d${todos.length + 1}`, text, done: false, t: NOW.getTime() }; todos.push(t); return t; },
      list: () => todos,
      complete: (q) => { const t = todos.find((x) => !x.done && (x.id === q || x.text.toLowerCase().includes(q.toLowerCase()))); if (!t) return null; t.done = true; return t; },
    },
    ...over,
  });
  const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args);
  return { tools, run, notes, reminders, todos };
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

test('reminders understand plain words, deadlines and reject the past', async () => {
  const { run, reminders } = realTools();
  assert.match(await run('set_reminder', { text: 'tea', when: 'in 10 minutes' }), /Reminder set .*: tea/);
  assert.equal(reminders[0].at, NOW.getTime() + 10 * 60_000);
  assert.match(await run('set_reminder', { text: 'meeting', when: 'tomorrow 9am' }), /Friday 2026-10-30 09:00/);
  // a deadline with minutes_before: notify 30 minutes ahead of 5 pm
  assert.match(await run('set_reminder', { text: 'Submit', when: '5pm', minutes_before: 30 }), /Thursday 2026-10-29 16:30.*deadline Thursday 2026-10-29 17:00/);
  assert.equal(reminders[2].at, new Date(2026, 9, 29, 16, 30).getTime());
  // the old argument forms still work
  assert.match(await run('set_reminder', { text: 'x', minutes: 5 }), /Reminder set/);
  assert.match(await run('set_reminder', { text: 'x', at: '2026-10-30T09:00' }), /2026-10-30 09:00/);
  // errors tell the model how to fix the call
  assert.match(await run('set_reminder', { text: 'x', when: '2020-01-01T00:00' }), /already passed/);
  assert.match(await run('set_reminder', { text: 'x', when: 'whenever' }), /could not understand the time "whenever"/);
  assert.match(await run('set_reminder', { text: 'x' }), /"when" is missing/);
});

test('a deadline that is closer than minutes_before reminds right away', async () => {
  const { run, reminders } = realTools();
  await run('set_reminder', { text: 'Submit', when: 'in 10 minutes', minutes_before: 30 });
  assert.equal(reminders[0].at, NOW.getTime() + 60_000);
});

test('reminders can be listed and cancelled', async () => {
  const { run } = realTools();
  assert.equal(await run('list_reminders', {}), 'No upcoming reminders.');
  await run('set_reminder', { text: 'tea', when: 'in 10 minutes' });
  assert.match(await run('list_reminders', {}), /\[1\] .* - tea/);
  assert.equal(await run('cancel_reminder', { id: 1 }), 'Cancelled reminder 1.');
  assert.match(await run('cancel_reminder', { id: 9 }), /no reminder 9/);
});

test('to-dos can be added, listed and ticked off by words', async () => {
  const { run } = realTools();
  await run('add_todo', { text: 'Buy milk' });
  await run('add_todo', { text: 'Call mum' });
  assert.match(await run('list_todos', {}), /\[ \] Buy milk/);
  assert.equal(await run('complete_todo', { item: 'milk' }), 'Done: Buy milk');
  assert.doesNotMatch(await run('list_todos', {}), /Buy milk/);
  assert.match(await run('complete_todo', { item: 'dentist' }), /no open to-do/);
});

test('parse_time and convert_units do the arithmetic for the model', async () => {
  const { run } = realTools();
  assert.match(await run('parse_time', { when: 'tomorrow 3pm' }), /ISO 2026-10-30T15:00 {2}\| {2}in 1 day|ISO 2026-10-30T15:00.*in 24 hours 30 min/);
  assert.match(await run('parse_time', { when: 'blah' }), /^Error/);
  assert.equal(await run('convert_units', { value: 5, from: 'miles', to: 'km' }), '5 mi = 8.04672 km');
});

test('weather and wikipedia use a User-Agent and survive bad answers', async () => {
  const seen: { url: string; ua?: string }[] = [];
  const { run } = realTools({
    fetchText: async (url, init) => {
      seen.push({ url, ua: init?.headers?.['User-Agent'] });
      if (url.includes('geocoding')) return { status: 200, text: JSON.stringify({ results: [{ name: 'Pilani', country: 'India', latitude: 28.4, longitude: 75.6 }] }), contentType: 'application/json' };
      if (url.includes('open-meteo')) return { status: 200, text: JSON.stringify({ current: { temperature_2m: 31.2, apparent_temperature: 33, weather_code: 2, wind_speed_10m: 9, precipitation: 0 }, daily: { time: ['2026-10-29'], temperature_2m_min: [18], temperature_2m_max: [33], weather_code: [1], precipitation_probability_max: [5] } }), contentType: 'application/json' };
      if (url.includes('rest_v1/page/summary/Ada')) return { status: 200, text: JSON.stringify({ title: 'Ada Lovelace', extract: 'English mathematician.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ada_Lovelace' } } }), contentType: 'application/json' };
      return { status: 200, text: 'Please set a user-agent', contentType: 'text/plain' };
    },
  });
  const w = await run('weather', { place: 'Pilani' });
  assert.match(w, /Pilani, India: now 31°C .*partly cloudy/);
  assert.match(w, /2026-10-29: 18-33°C, mostly clear, rain chance 5%/);
  assert.match(await run('wikipedia', { topic: 'Ada' }), /Ada Lovelace: English mathematician\.\nSource: https:\/\/en\.wikipedia/);
  assert.match(await run('wikipedia', { topic: 'Zzzz' }), /^Error: Wikipedia did not answer/);
  assert.ok(seen.every((r) => /LFM3Pocket/.test(r.ua ?? '')), 'every request carries a User-Agent');
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

// ---- approval ---------------------------------------------------------------------------------

test('tools that change the outside world pause for approval, and nothing runs yet', async () => {
  let ran = 0;
  const post: Tool = {
    name: 'slack_post', description: '', parameters: {},
    approval: (a) => `Post to #${a.channel}: "${a.text}"`,
    async run() { ran++; return 'Posted.'; },
  };
  const { deps } = setup([use(call('slack_post', { channel: 'general', text: 'hi' }, 'p1'))], { requireApproval: true }, [post]);
  const r = await runTask(newTask(), deps);
  assert.equal(ran, 0);
  assert.equal(r.status, 'waiting');
  assert.deepEqual(r.pending, [{ callId: 'p1', kind: 'approve', question: 'Post to #general: "hi"', tool: 'slack_post', args: { channel: 'general', text: 'hi' } }]);
});

test('with approvals switched off the tool just runs', async () => {
  let ran = 0;
  const post: Tool = { name: 'slack_post', description: '', parameters: {}, approval: () => 'x', async run() { ran++; return 'Posted.'; } };
  const { deps } = setup([use(call('slack_post', {}, 'p1')), say('done')], { requireApproval: false }, [post]);
  const r = await runTask(newTask(), deps);
  assert.equal(ran, 1);
  assert.equal(r.status, 'done');
});

test('read-only tools never ask for approval', async () => {
  const { deps } = setup([use(call('echo', { text: 'x' }, 'e')), say('ok')], { requireApproval: true }, [echo]);
  assert.equal((await runTask(newTask(), deps)).status, 'done');
});

test('an approval keeps the task waiting for the user, not for teammates', async () => {
  const pending = [{ callId: 'a', kind: 'approve' as const, question: 'q' }, { callId: 'b', kind: 'child' as const, childId: 'c1' }];
  const r = resolvePending(newTask({ pending, messages: [] }), 'b', 'child result');
  assert.equal(r.status, 'waiting');
  const r2 = resolvePending({ ...newTask({ pending: [pending[0]] }) }, 'a', 'denied');
  assert.equal(r2.status, 'queued');
});

const stub = (name: string, web = false, finishes = false): Tool => ({ name, description: name, web, finishes, parameters: { type: 'object', properties: { q: { type: 'string' } } }, async run() { return 'result'; } });

test('a reminder task is offered only the reminder tools', async () => {
  const { deps, llm } = setup([say('ok')], {}, [stub('set_reminder', false, true), stub('list_reminders'), stub('web_search', true), stub('fetch_url', true), echo]);
  await runTask(newTask({ goal: 'Remind me at 11:30 to submit the assignment' }), deps);
  const names = llm.requests[0].tools.map((t: any) => t.function.name);
  assert.deepEqual(names.sort(), ['ask_user', 'list_reminders', 'set_reminder']);
  assert.match(llm.requests[0].system, /SKILL: Reminders and deadlines/);
  assert.match(llm.requests[0].system, /set_reminder \{"text": "Submit the BITS assignment"/);
});

test('a bare deadline ("by 12") is treated as a reminder, not a web search', async () => {
  const { deps, llm } = setup([say('ok')], {}, [stub('set_reminder'), stub('web_search', true)]);
  await runTask(newTask({ goal: 'Submit bits assignment by 12' }), deps);
  assert.deepEqual(llm.requests[0].tools.map((t: any) => t.function.name).sort(), ['ask_user', 'set_reminder']);
});

test('the run starts with a visible Skill step', async () => {
  const { deps } = setup([say('ok')], {}, [stub('calculator'), stub('convert_units')]);
  const r = await runTask(newTask({ goal: 'what is 18 * 25?' }), deps);
  const first = r.steps![0];
  assert.equal(first.title, 'Skill: Math and conversions');
  assert.match(first.detail!, /calculator, convert_units/);
});

test('lookups get a few web calls, then a budget message', async () => {
  const lookups = [1, 2, 3, 4, 5].map((i) => use(call('web_search', { q: `q${i}` }, `w${i}`)));
  const { deps, llm } = setup([...lookups, say('gave up')], {}, [stub('web_search', true)]);
  const r = await runTask(newTask({ goal: 'search for the capital of Peru' }), deps);
  assert.equal(r.status, 'done');
  const results = llm.requests[5].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content);
  assert.equal(results.filter((c: string) => c === 'result').length, 3);
  assert.ok(results.some((c: string) => /budget used up/.test(c)));
});

test('after a finishing tool the model is told to confirm, and repeating it is refused', async () => {
  const { deps, llm } = setup(
    [use(call('set_reminder', { text: 'x', when: '5pm' }, 'a')), use(call('set_reminder', { text: 'x', when: '5pm' }, 'b')), say('Reminder set.')],
    {},
    [stub('set_reminder', false, true)],
  );
  const r = await runTask(newTask({ goal: 'remind me at 5pm to x' }), deps);
  assert.equal(r.status, 'done');
  assert.match(llm.requests[1].messages.at(-1).content, /Done\. If the user asked for anything else/);
  assert.match(llm.requests[2].messages.at(-1).content, /Already done/);
});

test('skills route requests, and missing connections say so', async () => {
  const names = ['set_reminder', 'calendar_list_events', 'calendar_create_event', 'parse_time'];
  assert.equal(pickSkills('Remind me to call Ann tomorrow', names)[0].id, 'reminders');
  assert.equal(pickSkills('what is on my calendar', names)[0].id, 'calendar');
  assert.equal(pickSkills('weather in Delhi', names)[0].id, 'weather');
  assert.equal(pickSkills('18% of 2500', names)[0].id, 'math');
  assert.equal(pickSkills('tell me a joke', names)[0].id, 'general');
  const mail = pickSkills('any unread email?', names)[0];
  assert.deepEqual(mail.tools, []);
  assert.match(mail.steps[0], /Gmail is not connected/);
  // an exclusive skill is not mixed with others
  assert.equal(pickSkills('remind me to search the weather', names).length, 1);
});

test('times are read on the clock of the user\'s chosen zone, whatever the phone says', async () => {
  const instant = new Date(Date.UTC(2026, 9, 29, 9, 0)); // 14:30 in Kolkata
  const { run, reminders } = realTools({ now: () => instant, zone: () => 'Asia/Kolkata' });
  assert.match(await run('get_time', {}), /Thursday 2026-10-29 14:30 \(IST\)/);
  assert.match(await run('set_reminder', { text: 'Submit', when: 'tomorrow 9am' }), /Friday 2026-10-30 09:00 \(IST\)/);
  assert.equal(new Date(reminders[0].at).toISOString(), '2026-10-30T03:30:00.000Z');
  // "5pm" is 5 pm in India, which is 11:30 UTC today
  await run('set_reminder', { text: 'x', when: '5pm' });
  assert.equal(new Date(reminders[1].at).toISOString(), '2026-10-29T11:30:00.000Z');
  assert.match(await run('parse_time', { when: 'tomorrow 3pm' }), /ISO 2026-10-30T15:00/);
  assert.match(await run('list_reminders', {}), /2026-10-30 09:00 \(IST\)/);
});

test('the prompt shows the time in the user\'s zone and the persona line', async () => {
  const { deps, llm } = setup([say('ok')], { zone: 'Asia/Kolkata', persona: 'Your name is Bloop.' });
  deps.now = () => new Date(Date.UTC(2026, 9, 29, 9, 0));
  await runTask(newTask(), deps);
  assert.match(llm.requests[0].system, /Current time: Thursday 2026-10-29 14:30 \(IST\)/);
  assert.match(llm.requests[0].system, /Your name is Bloop\./);
});
