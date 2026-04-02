/**
 * src/mcp/types.ts
 *
 * MCP Client 系统的类型定义。
 *
 * v7.0: 初始实现
 */

/** MCP Server 配置 */
export interface MCPServerConfig {
  /** Server 唯一名称（用于标识和工具命名前缀） */
  name: string;
  /** 传输方式 */
  transport: 'stdio' | 'sse';
  /** stdio: 启动命令 */
  command?: string;
  /** stdio: 命令参数 */
  args?: string[];
  /** 环境变量（支持 ${ENV_VAR} 引用） */
  env?: Record<string, string>;
  /** sse: 服务器 URL */
  url?: string;
  /** sse: 自定义请求头 */
  headers?: Record<string, string>;
  /** 是否随系统自动启动（默认 false） */
  autoStart?: boolean;
}

/** MCP 配置文件格式 */
export interface MCPConfig {
  servers: Record<string, Omit<MCPServerConfig, 'name'>>;
}

/** MCP 工具信息（从 MCP Server 通过 tools/list 发现） */
export interface MCPToolInfo {
  /** 所属 Server 名称 */
  serverName: string;
  /** 工具名称 */
  toolName: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: Record<string, unknown>;
}

/** MCP Server 连接状态 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  transport: string;
  uptime?: number;
  error?: string;
}

/** MCP 工具适配器注册结果 */
export interface MCPToolRegistration {
  /** 注册的工具数量 */
  count: number;
  /** 注册的工具名称列表 */
  toolNames: string[];
}
