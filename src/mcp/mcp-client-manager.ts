/**
 * src/mcp/mcp-client-manager.ts
 *
 * MCP 连接管理器 — 管理多个 MCP Server 的连接生命周期。
 *
 * v7.0: 初始实现
 *
 * 职责：
 * - 加载配置文件
 * - 启动/停止 MCP Server 连接（stdio / SSE）
 * - 发现 MCP Server 提供的工具
 * - 将 MCP 工具同步到 ToolRegistry
 * - 路由工具调用到正确的 MCP Server
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from '../tools/registry.js';
import type { MCPServerConfig, MCPConfig, MCPServerStatus, MCPToolInfo, MCPToolRegistration } from './types.js';
import { mcpToolToTool } from './tool-adapter.js';

/** 单个 MCP Server 连接的内部状态 */
interface MCPConnection {
  config: MCPServerConfig;
  process?: ChildProcess;
  tools: MCPToolInfo[];
  connected: boolean;
  connectedAt?: number;
  error?: string;
  /** SSE 传输的 URL（用于后续 HTTP POST 发送消息） */
  _sseUrl?: string;
}

/** MCP 请求的 JSON-RPC 消息 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC 响应 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (result: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  /**
   * 从配置文件加载 MCP Server 配置
   *
   * 配置文件路径：.firmclaw/mcp-servers.yaml
   * 支持 ${ENV_VAR} 环境变量引用
   */
  async loadConfig(configPath: string): Promise<void> {
    if (!fs.existsSync(configPath)) {
      return;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = this.parseYaml(content);

    if (!config || !config.servers) return;

    for (const [name, serverConf] of Object.entries(config.servers)) {
      const fullConfig: MCPServerConfig = {
        name,
        ...this.resolveEnvVars(serverConf as Record<string, unknown>),
      } as MCPServerConfig;

      this.configs.set(name, fullConfig);
    }
  }

  /**
   * 启动指定的 MCP Server 连接
   *
   * stdio: 启动子进程，通过 stdin/stdout 通信
   * sse: 建立 HTTP SSE 连接
   *
   * 连接成功后自动调用 tools/list 获取工具列表
   */
  async connect(serverName: string): Promise<MCPToolRegistration> {
    const config = this.configs.get(serverName);
    if (!config) {
      throw new Error(`MCP server not configured: "${serverName}"`);
    }

    // 如果已连接，先断开
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName);
    }

    const connection: MCPConnection = {
      config,
      tools: [],
      connected: false,
    };

    try {
      if (config.transport === 'stdio') {
        await this.connectStdio(serverName, connection);
      } else {
        await this.connectSSE(serverName, connection);
      }

      // 执行 MCP 握手：initialize + initialized
      await this.sendRequest(connection, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'firmclaw', version: '7.0.0' },
      });

      await this.sendNotification(connection, 'notifications/initialized', {});

      // 获取工具列表
      const toolsResult = await this.sendRequest(connection, 'tools/list', {});
      const toolsResponse = toolsResult.result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };

      if (toolsResponse?.tools) {
        connection.tools = toolsResponse.tools.map(t => ({
          serverName,
          toolName: t.name,
          description: t.description || '',
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
        }));
      }

      connection.connected = true;
      connection.connectedAt = Date.now();
      this.connections.set(serverName, connection);

      return {
        count: connection.tools.length,
        toolNames: connection.tools.map(t => `mcp__${serverName}__${t.toolName}`),
      };
    } catch (error) {
      connection.error = error instanceof Error ? error.message : String(error);
      this.connections.set(serverName, connection);
      throw error;
    }
  }

  /**
   * 断开指定 MCP Server
   *
   * stdio: 终止子进程
   * sse: 关闭 HTTP 连接
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (!connection) return;

    if (connection.process) {
      connection.process.kill('SIGTERM');
      // 等待进程退出
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          connection.process?.kill('SIGKILL');
          resolve();
        }, 5000);
        connection.process!.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        // 如果进程已退出
        if (connection.process!.killed || connection.process!.exitCode !== null) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    connection.connected = false;
    connection.process = undefined;
    connection.tools = [];
    this.connections.delete(serverName);
  }

  /**
   * 启动所有 autoStart: true 的 Server
   *
   * 在系统初始化时调用
   */
  async autoConnect(registry: ToolRegistry): Promise<void> {
    for (const [name, config] of this.configs) {
      if (config.autoStart) {
        try {
          const result = await this.connect(name);
          this.syncToolsToRegistry(name, registry);
          // 注册的工具已在 connect 中获取
        } catch (error) {
          const conn = this.connections.get(name);
          if (conn) {
            conn.error = error instanceof Error ? error.message : String(error);
          }
        }
      }
    }
  }

  /**
   * 断开所有连接（系统关闭时调用）
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys());
    await Promise.all(names.map(name => this.disconnect(name)));
  }

  /**
   * 将指定 Server 的工具同步到 ToolRegistry
   */
  syncToolsToRegistry(serverName: string, registry: ToolRegistry): MCPToolRegistration {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.connected) {
      return { count: 0, toolNames: [] };
    }

    const toolNames: string[] = [];
    for (const toolInfo of connection.tools) {
      const tool = mcpToolToTool(toolInfo, this);
      registry.register(tool);
      toolNames.push(tool.name);
    }

    return { count: toolNames.length, toolNames };
  }

  /**
   * 列出所有 Server 的连接状态
   */
  getStatus(): MCPServerStatus[] {
    const statuses: MCPServerStatus[] = [];

    for (const [name, config] of this.configs) {
      const connection = this.connections.get(name);
      const now = Date.now();

      statuses.push({
        name,
        connected: connection?.connected ?? false,
        toolCount: connection?.tools.length ?? 0,
        transport: config.transport,
        uptime: connection?.connectedAt ? now - connection.connectedAt : undefined,
        error: connection?.error,
      });
    }

    return statuses;
  }

  /**
   * 调用指定 MCP Server 的工具
   *
   * 由 ToolAdapter 通过 ToolRegistry.execute() 间接调用
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }> {
    const connection = this.connections.get(serverName);
    if (!connection || !connection.connected) {
      return {
        content: `Error: MCP server "${serverName}" is not connected.`,
        isError: true,
      };
    }

    try {
      const result = await this.sendRequest(connection, 'tools/call', {
        name: toolName,
        arguments: args,
      });

      const toolResult = result.result as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      if (result.error) {
        return {
          content: `MCP Error [${result.error.code}]: ${result.error.message}`,
          isError: true,
        };
      }

      // MCP tool result 格式: { content: [{ type: "text", text: "..." }] }
      if (toolResult?.content) {
        const textParts = toolResult.content
          .filter(c => c.type === 'text' && c.text)
          .map(c => c.text!)
          .join('\n');

        return {
          content: textParts || 'Tool returned empty content.',
          isError: toolResult.isError,
        };
      }

      return { content: 'Tool returned no content.' };
    } catch (error) {
      return {
        content: `MCP call failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  /**
   * 检查指定 Server 是否已连接
   */
  isConnected(serverName: string): boolean {
    return this.connections.get(serverName)?.connected ?? false;
  }

  /**
   * 获取所有已连接 Server 的工具列表
   */
  listAllTools(): MCPToolInfo[] {
    const tools: MCPToolInfo[] = [];
    for (const connection of this.connections.values()) {
      if (connection.connected) {
        tools.push(...connection.tools);
      }
    }
    return tools;
  }

  /**
   * 获取所有已配置的 Server 名称
   */
  getConfiguredServers(): string[] {
    return Array.from(this.configs.keys());
  }

  // ═══════════════════════════════════════════════════
  // 私有方法：传输层实现
  // ═══════════════════════════════════════════════════

  /**
   * 通过 stdio 启动子进程连接
   */
  private async connectStdio(serverName: string, connection: MCPConnection): Promise<void> {
    const config = connection.config;
    if (!config.command) {
      throw new Error(`MCP server "${serverName}": no command specified for stdio transport`);
    }

    const env: Record<string, string> = { ...process.env as Record<string, string> };

    // 合并自定义环境变量（支持 ${ENV_VAR} 引用已在 resolveEnvVars 中处理）
    if (config.env) {
      Object.assign(env, config.env);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(config.command!, config.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });

      connection.process = proc;

      // 设置 stdout 数据处理
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleStdioData(connection, data.toString());
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          // MCP 协议的 stderr 用于日志，不作为协议消息
          // 但如果进程启动失败，这里会有错误信息
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to start MCP server "${serverName}": ${error.message}`));
      });

      proc.on('exit', (code) => {
        if (connection.connected) {
          connection.connected = false;
          connection.error = `Process exited with code ${code}`;
        }
      });

      // 给进程一些时间启动
      setTimeout(() => {
        if (proc.pid) {
          resolve();
        } else {
          reject(new Error(`MCP server "${serverName}" failed to start`));
        }
      }, 500);
    });
  }

  /**
   * 通过 SSE 连接远程 MCP Server
   */
  private async connectSSE(_serverName: string, _connection: MCPConnection): Promise<void> {
    // SSE 传输：使用 HTTP POST + SSE 接收
    // 简化实现：通过 fetch 调用
    // 完整实现需要 WebSocket 或 SSE 客户端
    const config = _connection.config;
    if (!config.url) {
      throw new Error(`MCP server "${_serverName}": no URL specified for SSE transport`);
    }

    // 验证连接可用性
    try {
      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          ...config.headers,
          'Accept': 'text/event-stream',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      // SSE 模式下使用 streamable HTTP 模型
      // 对于 SSE 传输，我们使用 HTTP POST 进行消息传递
      _connection._sseUrl = config.url;
    } catch (error) {
      throw new Error(
        `Failed to connect to SSE MCP server "${_serverName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 处理 stdio 传输的 JSON-RPC 数据
   */
  private handleStdioData(_connection: MCPConnection, data: string): void {
    // 每行一个 JSON-RPC 消息
    const lines = data.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pendingRequests.get(message.id ?? -1);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id ?? -1);
          pending.resolve(message);
        }
      } catch {
        // 非 JSON 行忽略
      }
    }
  }

  /**
   * 发送 JSON-RPC 请求（等待响应）
   */
  private sendRequest(
    connection: MCPConnection,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const id = ++this.requestId;
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.sendRaw(connection, JSON.stringify(message));
    });
  }

  /**
   * 发送 JSON-RPC 通知（不等待响应）
   */
  private sendNotification(
    connection: MCPConnection,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendRaw(connection, JSON.stringify(message));
  }

  /**
   * 发送原始消息到 MCP Server
   */
  private sendRaw(connection: MCPConnection, message: string): void {
    if (connection.config.transport === 'stdio' && connection.process?.stdin) {
      connection.process.stdin.write(message + '\n');
    } else if (connection.config.transport === 'sse' && connection._sseUrl) {
      // SSE 模式：通过 HTTP POST 发送消息
      fetch(connection._sseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...connection.config.headers,
        },
        body: message,
      }).catch(() => {
        // SSE 消息发送失败忽略
      });
    }
  }

  /**
   * 解析环境变量引用 ${VAR_NAME}
   */
  private resolveEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
          return process.env[varName] || '';
        });
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.resolveEnvVars(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 简易 YAML 解析（与 SkillParser 共享类似逻辑）
   */
  private parseYaml(content: string): MCPConfig | null {
    try {
      const lines = content.split('\n');
      const result: Record<string, unknown> = {};
      let currentSection: string | null = null;
      let currentItem: string | null = null;
      let currentIndent = 0;

      for (const line of lines) {
        // 跳过注释和空行
        if (line.trim() === '' || line.trim().startsWith('#')) continue;

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();

        // 顶层 key
        if (indent === 0 && trimmed.endsWith(':')) {
          currentSection = trimmed.slice(0, -1).trim();
          result[currentSection] = {};
          currentIndent = 0;
          continue;
        }

        // section 下的 key
        if (currentSection && indent <= currentIndent && trimmed.endsWith(':')) {
          currentItem = trimmed.slice(0, -1).trim();
          (result[currentSection] as Record<string, unknown>)[currentItem] = {};
          currentIndent = indent;
          continue;
        }

        // key-value pair
        const kvMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
        if (kvMatch) {
          const kvKey = kvMatch[1];
          let kvValue: unknown = kvMatch[2].trim();

          // 去除引号
          if (typeof kvValue === 'string') {
            kvValue = kvValue.replace(/^["']|["']$/g, '');
            if (kvValue === 'true') kvValue = true;
            else if (kvValue === 'false') kvValue = false;
            else if (typeof kvValue === 'string' && kvValue.match(/^\d+$/)) kvValue = parseInt(kvValue, 10);
          }

          if (currentItem) {
            (result[currentSection] as Record<string, Record<string, unknown>>)[currentItem]![kvKey] = kvValue;
          } else if (currentSection) {
            (result[currentSection] as Record<string, unknown>)[kvKey] = kvValue;
          } else {
            result[kvKey] = kvValue;
          }
          continue;
        }

        // 列表项
        const listMatch = trimmed.match(/^-\s+(.*)$/);
        if (listMatch && currentSection && currentItem) {
          const item = listMatch[1].replace(/^["']|["']$/g, '');
          const parent = (result[currentSection] as Record<string, Record<string, unknown>>)[currentItem];
          if (Array.isArray(parent)) {
            (parent as unknown[]).push(item);
          } else {
            (result[currentSection] as Record<string, Record<string, unknown>>)[currentItem] = [item];
          }
          currentIndent = indent;
          continue;
        }
      }

      return result as unknown as MCPConfig;
    } catch {
      return null;
    }
  }
}

