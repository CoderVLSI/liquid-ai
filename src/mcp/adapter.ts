import type { Skill } from '../agents/skills.ts';
import type { Tool } from '../agents/types.ts';
import type { McpClient, McpToolInfo } from './client.ts';
import type { McpServerConfig } from './types.ts';

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'server';

const RISKY = /(run|exec|shell|command|write|delete|remove|edit|create|send|post|update|move|kill)/i;

function summarize(args: Record<string, any>): string {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v.length > 120 ? v.slice(0, 120) + '…' : v) : JSON.stringify(v)}`)
    .join(', ');
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}

/** The model-facing tool for one MCP tool. Names are "<server>_<tool>" (letters, digits, underscore; at most 64). */
export function adaptTool(cfg: McpServerConfig, client: McpClient, info: McpToolInfo): Tool {
  const name = `${slug(cfg.name)}_${info.name.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 64);
  const schema = info.inputSchema && typeof info.inputSchema === 'object' ? info.inputSchema : {};
  // a computer or VM can run commands and change files: those tools always ask, whatever the toggle says
  const asks = cfg.approve || (cfg.kind === 'pc' && RISKY.test(info.name));
  return {
    name,
    description: `[${cfg.name}] ${info.description ?? info.name}`.slice(0, 600),
    parameters: { type: 'object', properties: {}, ...schema },
    approval: asks ? (a) => `Run "${info.name}" on ${cfg.name}${Object.keys(a).length ? `:\n${summarize(a)}` : '.'}` : undefined,
    web: cfg.kind === 'mcp' && /^https?:\/\/(?!(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i.test(cfg.url),
    run: (a) => client.callTool(info.name, a),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A playbook per server so the router can pick its tools when the user names it (or, for a computer, talks about it). */
export function serverSkill(cfg: McpServerConfig, tools: Tool[]): Skill {
  const words = [cfg.name, ...(cfg.kind === 'pc' ? ['my (pc|computer|laptop|vm|server|machine|desktop)', 'on the (pc|computer|vm|server)', 'terminal', 'shell', 'run (a |the )?command'] : [])];
  const match = new RegExp(`\\b(${[escapeRe(cfg.name), ...words.slice(1)].join('|')})\\b`, 'i');
  const names = tools.map((t) => t.name);
  return {
    id: `mcp_${slug(cfg.name)}`,
    name: cfg.name,
    match,
    tools: [...names, 'get_time', 'parse_time'],
    steps:
      cfg.kind === 'pc'
        ? [
            `${cfg.name} is a computer the user connected. Its tools can look at files and run commands there.`,
            'Pick the one tool that does the job, read its description, and fill in its arguments as JSON.',
            'Run one tool at a time and read its output before the next step. Keep commands small and safe.',
            'The user is asked to approve commands and file changes. Say in one sentence what you did and the key part of the output.',
          ]
        : [
            `Use the ${cfg.name} tools for this request.`,
            'Pick the one tool that does the job, read its description, and fill in its arguments as JSON from the user\'s words.',
            'Then answer in one or two short sentences using only what the tool returned.',
          ],
    examples: [],
  };
}
