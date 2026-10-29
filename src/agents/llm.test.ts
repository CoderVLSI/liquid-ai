import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatResponse, ServerLlm } from './llm.ts';

test('parses plain text answers', () => {
  const r = parseChatResponse({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] });
  assert.deepEqual(r, { content: 'hello', toolCalls: [], finish: 'stop' });
});

test('parses tool calls, generating ids when the server omits them', () => {
  const r = parseChatResponse(
    { choices: [{ message: { content: null, tool_calls: [{ function: { name: 'calculator', arguments: '{"expression":"1+1"}' } }, { id: 'abc', function: { name: 'get_time', arguments: { x: 1 } } }] }, finish_reason: 'tool_calls' }] },
    123,
  );
  assert.equal(r.content, '');
  assert.deepEqual(r.toolCalls, [
    { id: 'call_123_0', name: 'calculator', arguments: '{"expression":"1+1"}' },
    { id: 'abc', name: 'get_time', arguments: '{"x":1}' },
  ]);
});

test('ignores nameless tool calls and empty responses', () => {
  assert.deepEqual(parseChatResponse({ choices: [{ message: { tool_calls: [{ function: {} }] } }] }).toolCalls, []);
  assert.equal(parseChatResponse({}).content, '');
});

test('sends tools only when given, and surfaces HTTP errors', async () => {
  let body: any = null;
  const ok: any = async (_u: string, init: any) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'k' } }] }) };
  };
  const llm = new ServerLlm(() => 'http://127.0.0.1:18080', ok);
  await llm.chat({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: null });
  assert.equal(body.tools, undefined);
  assert.equal(body.messages[0].role, 'system');
  await llm.chat({ system: 'sys', messages: [], tools: [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }] });
  assert.equal(body.tool_choice, 'auto');

  const bad: any = async () => ({ ok: false, status: 503, text: async () => 'loading model' });
  await assert.rejects(new ServerLlm(() => 'http://x', bad).chat({ system: '', messages: [], tools: null }), /HTTP 503: loading model/);
});
