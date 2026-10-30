import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpClient, parseRpcBody } from './client.ts';
import type { HttpReply, Poster } from './client.ts';
import { adaptTool, serverSkill, slug } from './adapter.ts';
import type { McpServerConfig } from './types.ts';

const cfg = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({ id: 's1', name: 'My PC', url: 'http://192.168.1.20:8765/mcp', token: 'sekret', enabled: true, approve: true, kind: 'pc', ...over });

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): HttpReply => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const h = { 'content-type': typeof body === 'string' ? 'text/event-stream' : 'application/json', ...headers };
  return { status, header: (n) => h[n.toLowerCase() as keyof typeof h] ?? null, text: async () => text };
};

/** A tiny fake MCP server behind the Poster interface. */
function fakeServer(opts: { sse?: boolean; status?: number } = {}) {
  const seen: { method: string; headers: Record<string, string>; params?: any }[] = [];
  const post: Poster = async (_url, init) => {
    const msg = JSON.parse(init.body);
    seen.push({ method: msg.method, headers: init.headers, params: msg.params });
    if (opts.status) return reply(opts.status, 'nope');
    if (msg.method === 'notifications/initialized') return reply(202, '');
    let result: any;
    if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', serverInfo: { name: 'pc-bridge' }, capabilities: {} };
    else if (msg.method === 'tools/list') result = msg.params?.cursor ? { tools: [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }] } : { tools: [{ name: 'run_command', description: 'Run' }], nextCursor: 'p2' };
    else if (msg.method === 'tools/call') result = msg.params.name === 'boom' ? { isError: true, content: [{ type: 'text', text: 'it broke' }] } : { content: [{ type: 'text', text: `ran ${msg.params.arguments.command ?? ''}` }] };
    const rpc = { jsonrpc: '2.0', id: msg.id, result };
    if (opts.sse) return reply(200, `: keep-alive\n\nevent: message\ndata: ${JSON.stringify(rpc)}\n\n`, msg.method === 'initialize' ? { 'mcp-session-id': 'abc' } : {});
    return reply(200, rpc, msg.method === 'initialize' ? { 'mcp-session-id': 'abc' } : {});
  };
  return { post, seen };
}

test('initialises, lists tools across pages and calls one', async () => {
  const { post, seen } = fakeServer();
  const c = new McpClient(cfg(), post);
  const tools = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['run_command', 'read_file']);
  assert.equal(await c.callTool('run_command', { command: 'ls' }), 'ran ls');
  assert.deepEqual(seen.map((s) => s.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'tools/call']);
  assert.equal(seen[0].headers.Authorization, 'Bearer sekret');
  assert.equal(seen[2].headers['Mcp-Session-Id'], 'abc'); // the session id from initialize is sent back
  assert.equal(seen[2].headers['MCP-Protocol-Version'], '2025-06-18');
});

test('understands event-stream replies', async () => {
  const { post } = fakeServer({ sse: true });
  const c = new McpClient(cfg(), post);
  assert.equal((await c.listTools()).length, 2);
  assert.equal(await c.callTool('run_command', { command: 'pwd' }), 'ran pwd');
});

test('a tool that reports isError becomes an Error: line, not an exception', async () => {
  const { post } = fakeServer();
  assert.equal(await new McpClient(cfg(), post).callTool('boom', {}), 'Error: it broke');
});

test('connection problems say what to check', async () => {
  await assert.rejects(new McpClient(cfg(), fakeServer({ status: 401 }).post).listTools(), /Check the access token/);
  await assert.rejects(new McpClient(cfg(), fakeServer({ status: 404 }).post).listTools(), /usually ends in \/mcp/);
  await assert.rejects(new McpClient(cfg(), async () => { throw new Error('Network request failed'); }).listTools(), /Could not reach My PC/);
});

test('parseRpcBody picks the right message from a stream with several', () => {
  const body = 'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n';
  assert.deepEqual(parseRpcBody(body, 'text/event-stream', 7), { jsonrpc: '2.0', id: 7, result: { ok: 1 } });
  assert.equal(parseRpcBody(body, 'text/event-stream', 8), null);
});

test('adapted tools get safe names and ask before risky actions on a computer', async () => {
  const { post } = fakeServer();
  const c = new McpClient(cfg({ approve: false }), post);
  const run = adaptTool(cfg({ approve: false }), c, { name: 'run_command', description: 'Run a shell command', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } });
  const read = adaptTool(cfg({ approve: false }), c, { name: 'read_file' });
  assert.equal(run.name, 'my_pc_run_command');
  assert.match(run.approval!({ command: 'rm -rf /tmp/x' }), /Run "run_command" on My PC:\ncommand="rm -rf \/tmp\/x"/);
  assert.equal(read.approval, undefined); // reading is fine without asking when the toggle is off
  assert.equal(await run.run({ command: 'echo hi' }), 'ran echo hi');
  const strict = adaptTool(cfg({ approve: true }), c, { name: 'read_file' });
  assert.ok(strict.approval);
  assert.equal(slug('Weather & News!'), 'weather_news');
});

test('a server skill is picked when the user names the server or talks about their computer', () => {
  const c = new McpClient(cfg(), fakeServer().post);
  const tools = [adaptTool(cfg(), c, { name: 'run_command' })];
  const skill = serverSkill(cfg(), tools);
  assert.ok(skill.match.test('list the files on my pc'));
  assert.ok(skill.match.test('ask My PC for disk usage'));
  assert.ok(!skill.match.test('what is the weather'));
  assert.deepEqual(skill.tools.slice(0, 1), ['my_pc_run_command']);
});
