import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personaLine, withPersona } from './profile.ts';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts';

const base = { agentName: 'Pocket', userName: '', goals: '', interests: [] as string[], tone: 'friendly' as const };

test('persona line names the assistant and the user, and skips empty fields', () => {
  assert.match(personaLine(base), /^Your name is Pocket\. Be warm and friendly, but keep answers short\. Reply in the language the user writes in\./);
  const p = personaLine({ ...base, agentName: 'Bloop', userName: 'Priya', interests: ['Studying and homework'], goals: 'keep track of assignments', tone: 'concise' });
  assert.match(p, /Your name is Bloop\./);
  assert.match(p, /The user's name is Priya/);
  assert.match(p, /mainly wants help with: Studying and homework; keep track of assignments\./);
  assert.match(p, /Be brief and direct/);
});

test('withPersona appends to a prompt', () => {
  assert.match(withPersona('You help.', { ...base, userName: 'Sam' }), /^You help\. Your name is Pocket\. The user's name is Sam; use it now and then, not in every sentence\. Be warm and friendly, but keep answers short\. Reply in the language/);
});

test('profile fields survive a settings round trip and old saves still load', () => {
  const saved = { ...DEFAULT_SETTINGS, onboarded: true, userName: 'Priya', interests: ['Notes and ideas'], timezone: 'Asia/Kolkata', buddy: 'bloop', mcpServers: [{ id: 'a', name: 'x', url: 'http://h/mcp', token: '', enabled: true, approve: true, kind: 'mcp' }] };
  const back = mergeSettings(JSON.parse(JSON.stringify(saved)));
  assert.equal(back.userName, 'Priya');
  assert.deepEqual(back.interests, ['Notes and ideas']);
  assert.equal(back.timezone, 'Asia/Kolkata');
  assert.equal(back.mcpServers.length, 1);
  const old = mergeSettings({ activeModel: 'omni', bargeIn: false });
  assert.equal(old.onboarded, false);
  assert.equal(old.agentName, 'Pocket');
  assert.equal(old.bargeIn, false);
});
