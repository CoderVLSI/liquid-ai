export interface McpServerConfig {
  id: string;
  name: string;
  /** the server's MCP endpoint, e.g. https://mcp.example.com/mcp or http://192.168.1.20:8765/mcp */
  url: string;
  /** sent as "Authorization: Bearer <token>" */
  token: string;
  enabled: boolean;
  /** ask the user before any tool of this server runs */
  approve: boolean;
  /** 'pc' = a computer or VM running tools/pc-bridge (file + command access); 'mcp' = any other MCP server */
  kind: 'mcp' | 'pc';
}
