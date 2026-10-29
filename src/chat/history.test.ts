import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from './history.ts';

test('system first, new user message last', () => {
  const r = buildRequest('sys', [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], { text: 'next' });
  assert.deepEqual(
    r.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
  );
  assert.equal(r[r.length - 1].content, 'next');
});

test('an image on the new message is sent first, with a default prompt', () => {
  const r = buildRequest('sys', [], { text: '', imageDataUri: 'data:image/jpeg;base64,AAA' });
  const parts = r[1].content as any[];
  assert.equal(parts[0].type, 'image_url');
  assert.equal(parts[1].text, 'Describe this image.');
});

test('old images are replaced by a note, never re-sent', () => {
  const r = buildRequest('sys', [{ role: 'user', text: 'what is this?', hasImage: true }], { text: 'and now?' });
  assert.equal(r[1].content, '[an image was attached] what is this?');
});

test('failed and empty messages are skipped; voice turns get a placeholder', () => {
  const r = buildRequest(
    'sys',
    [
      { role: 'user', text: 'boom' },
      { role: 'assistant', text: 'Error: x', error: true },
      { role: 'assistant', text: '   ' },
      { role: 'user', text: '', voice: true },
    ],
    { text: 'ok' },
  );
  assert.deepEqual(
    r.map((m) => m.content),
    ['sys', 'boom', '(the user spoke a voice message)', 'ok'],
  );
});

test('oldest turns are dropped first and the history never starts with the assistant', () => {
  const long = 'x'.repeat(100);
  const hist = [
    { role: 'user' as const, text: 'old question ' + long },
    { role: 'assistant' as const, text: 'old answer ' + long },
    { role: 'user' as const, text: 'recent question' },
    { role: 'assistant' as const, text: 'recent answer' },
  ];
  const r = buildRequest('sys', hist, { text: 'go' }, 160);
  const roles = r.map((m) => m.role);
  assert.equal(roles[0], 'system');
  assert.equal(roles[1], 'user');
  assert.ok(!r.some((m) => typeof m.content === 'string' && m.content.startsWith('old')));
});
