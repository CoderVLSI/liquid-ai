import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AGENTS, deserialize, serialize } from './persist.ts';
import type { AgentTask } from './types.ts';

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: 't', agentId: 'atlas', goal: 'g', status: 'queued', messages: [{ role: 'user', content: 'g' }], steps: [], pending: [], stepCount: 0, depth: 0, createdAt: 0, updatedAt: 0, ...over,
});

test('finished tasks drop their message history, active ones keep it', () => {
  const raw = serialize({ agents: DEFAULT_AGENTS, notes: [], tasks: [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'blocked' })] });
  const back = deserialize(raw);
  assert.equal(back.tasks.find((t) => t.id === 'a')!.messages.length, 0);
  assert.equal(back.tasks.find((t) => t.id === 'b')!.messages.length, 1);
});

test('tasks that were running when the app died are queued again', () => {
  const back = deserialize(serialize({ agents: DEFAULT_AGENTS, notes: [], tasks: [task({ status: 'running' })] }));
  assert.equal(back.tasks[0].status, 'queued');
});

test('built-in teammates are always present, custom ones are kept', () => {
  const custom = { id: 'c1', name: 'Chef', emoji: '🍳', role: 'Cooks.' };
  const back = deserialize(JSON.stringify({ agents: [custom], tasks: [], notes: [] }));
  assert.deepEqual(back.agents.map((a) => a.name), ['Pocket', 'Scout', 'Scribe', 'Chef']);
  assert.deepEqual(back.agents.filter((a) => a.hidden).map((a) => a.name), ['Scout', 'Scribe']);
});

test('corrupt or missing files fall back to a clean state', () => {
  assert.deepEqual(deserialize(null).tasks, []);
  assert.deepEqual(deserialize('{nope').notes, []);
  assert.equal(deserialize('{"tasks":"x"}').tasks.length, 0);
});

test('only the most recent tasks are kept', () => {
  const many = Array.from({ length: 80 }, (_, i) => task({ id: `t${i}`, status: 'done' }));
  const back = deserialize(serialize({ agents: DEFAULT_AGENTS, notes: [], tasks: many }));
  assert.equal(back.tasks.length, 60);
  assert.equal(back.tasks.at(-1)!.id, 't79');
});
