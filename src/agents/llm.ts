import type { LlmClient, LlmResponse } from './engine.ts';
import type { AgentMsg, ToolCall, ToolSchema } from './types.ts';

/** Reads one non-streaming /v1/chat/completions response. Exported for tests. */
export function parseChatResponse(json: any, now = Date.now()): LlmResponse {
  const choice = json?.choices?.[0];
  const msg = choice?.message ?? {};
  const toolCalls: ToolCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
    .map((c: any, i: number): ToolCall => {
      const args = c?.function?.arguments;
      return {
        id: typeof c?.id === 'string' && c.id ? c.id : `call_${now}_${i}`,
        name: String(c?.function?.name ?? ''),
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      };
    })
    .filter((c: ToolCall) => c.name);
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    toolCalls,
    finish: String(choice?.finish_reason ?? (toolCalls.length ? 'tool_calls' : 'stop')),
  };
}

/** Talks to the on-device llama.cpp server (OpenAI-compatible, with tool calling). */
export class ServerLlm implements LlmClient {
  baseUrl: () => string;
  fetchImpl: typeof fetch;

  constructor(baseUrl: () => string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async chat(req: { system: string; messages: AgentMsg[]; tools: ToolSchema[] | null; signal?: AbortSignal }): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: 'local',
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      stream: false,
      temperature: 0.2,
      max_tokens: 1024,
    };
    if (req.tools) {
      body.tools = req.tools;
      body.tool_choice = 'auto';
    }
    const res = await this.fetchImpl(`${this.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        // ignore
      }
      throw new Error(`Model server returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return parseChatResponse(await res.json());
  }
}
