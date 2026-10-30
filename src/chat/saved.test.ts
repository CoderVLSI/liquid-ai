import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHATS, archiveChat, hasContent, parseChats, takeChat, titleFor } from './saved.ts';
import { suggestFollowUps } from './followups.ts';
import type { ChatMsg } from '../state/app.ts';

const m = (role: 'user' | 'assistant', text: string, over: Partial<ChatMsg> = {}): ChatMsg => ({ id: Math.random().toString(36), role, text, t: 1000, ...over });

test('titles come from the first typed message', () => {
  assert.equal(titleFor([m('user', '  What is   the capital of Peru?  '), m('assistant', 'Lima')]), 'What is the capital of Peru?');
  assert.equal(titleFor([m('user', 'x'.repeat(80))]).length, 46);
  assert.equal(titleFor([m('user', '🎤 Voice message · 3.0 s', { voice: true })]), 'Voice chat');
  assert.equal(titleFor([m('user', '', { imageUri: 'file://a.jpg' })]), 'Photo chat');
  assert.equal(titleFor([]), 'New chat');
});

test('archiving keeps the newest first, skips empty chats and caps the list', () => {
  assert.deepEqual(archiveChat([], [], 5, 'a'), []);
  assert.deepEqual(archiveChat([], [m('assistant', 'hi')], 5, 'a'), []); // nobody spoke
  const one = archiveChat([], [m('user', 'first'), m('assistant', 'ok', { streaming: true })], 5, 'a');
  assert.equal(one[0].title, 'first');
  assert.equal(one[0].messages[1].streaming, false);
  const two = archiveChat(one, [m('user', 'second')], 6, 'b');
  assert.deepEqual(two.map((c) => c.id), ['b', 'a']);
  assert.deepEqual(archiveChat(two, [m('user', 'first again')], 7, 'a').map((c) => c.id), ['a', 'b']); // same id replaces
  let many: ReturnType<typeof archiveChat> = [];
  for (let i = 0; i < MAX_CHATS + 10; i++) many = archiveChat(many, [m('user', `q${i}`)], i, `c${i}`);
  assert.equal(many.length, MAX_CHATS);
  assert.equal(many[0].id, `c${MAX_CHATS + 9}`);
  assert.ok(hasContent([m('user', 'x')]));
});

test('taking a chat out of the list', () => {
  const list = archiveChat(archiveChat([], [m('user', 'a')], 1, 'a'), [m('user', 'b')], 2, 'b');
  const { chat, rest } = takeChat(list, 'a');
  assert.equal(chat!.title, 'a');
  assert.deepEqual(rest.map((c) => c.id), ['b']);
  assert.equal(takeChat(list, 'zzz').chat, null);
});

test('a damaged history file is ignored, not fatal', () => {
  assert.deepEqual(parseChats(null), []);
  assert.deepEqual(parseChats('{nope'), []);
  assert.deepEqual(parseChats('{"a":1}'), []);
  assert.equal(parseChats(JSON.stringify([{ id: 'x', title: 'T', t: 3, messages: [] }, { junk: 1 }])).length, 1);
});

test('follow-up suggestions depend on the reply', () => {
  assert.deepEqual(suggestFollowUps('Lima.'), ['Tell me more', 'Give an example']);
  assert.deepEqual(suggestFollowUps('x'.repeat(200)), ['Summarise that', 'Explain simply', 'Give an example']);
  assert.deepEqual(suggestFollowUps('Hello! How can I help you today?'), []); // it asked something
  assert.deepEqual(suggestFollowUps('(no answer)'), []);
  assert.deepEqual(suggestFollowUps(''), []);
});
