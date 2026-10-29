import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser, parseLine } from './sse.ts';

const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

test('parses content deltas and DONE', () => {
  const p = new SseParser();
  const out = p.push(
    ev({ choices: [{ delta: { content: 'Hel' } }] }) +
      ev({ choices: [{ delta: { content: 'lo' } }] }) +
      ev({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
      'data: [DONE]\n\n',
  );
  assert.deepEqual(out, [{ content: 'Hel' }, { content: 'lo' }, { finish: 'stop' }, { finish: 'done' }]);
});

test('handles events split across chunks', () => {
  const p = new SseParser();
  const full = ev({ choices: [{ delta: { content: 'split' } }] });
  const a = p.push(full.slice(0, 17));
  const b = p.push(full.slice(17));
  assert.deepEqual(a, []);
  assert.deepEqual(b, [{ content: 'split' }]);
});

test('handles CRLF line endings', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"choices":[{"delta":{"content":"x"}}]}\r\n\r\n'), [{ content: 'x' }]);
});

test('reports reasoning separately from content', () => {
  assert.deepEqual(parseLine('data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}'), { reasoning: 'hmm' });
});

test('surfaces server errors', () => {
  assert.deepEqual(parseLine('data: {"error":{"message":"boom"}}'), { error: 'boom' });
});

test('ignores comments, blanks and junk', () => {
  const p = new SseParser();
  assert.deepEqual(p.push(': keep-alive\n\ndata:\n\ndata: not json\n\n'), []);
});
