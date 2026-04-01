/**
 * src/gateway/server.ts
 *
 * WebSocket 服务器 —— FirmClaw 对外服务入口。
 *
 * 设计要点：
 * - 基于 ws 库实现标准 WebSocket
 * - JSON-RPC 2.0 协议
 * - 每个连接独立 AgentLoop 实例
 * - EventStream 事件自动转发到 WebSocket
 * - 依赖通过构造函数 + setter 注入（与现有代码风格一致）
 *
 * 生命周期：
 *   start() → listening → connection → message → response
 *                                      → notification（EventStream 转发）
 *                  → close / stop()
 *
 * v5.1: 初始实现
 * v5.4: 集成 Web UI（HTTP GET 返回聊天页面）
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type {
  GatewayConfig,
  ResolvedGatewayConfig,
  ConnectionContext,
  JsonRpcResponse,
  SettingsSnapshot,
} from './types.js';
import { ConnectionManager } from './connection.js';
import { MessageRouter } from './router.js';
import { AuthGuard } from './auth.js';
import { EVENT_TO_NOTIFICATION_METHOD } from './types.js';
import { JsonRpcErrorCode, RouteError } from './types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { SessionManager } from '../session/manager.js';
import type { ContextBuilder } from '../session/context-builder.js';
import type { TokenCounter } from '../utils/token-counter.js';
import type { Summarizer } from '../session/summarizer.js';
import type { AgentConfig } from '../agent/types.js';
import { AgentLoop } from '../agent/agent-loop.js';
import type { EventStream } from '../utils/event-stream.js';
import { getWebUIHTML } from './web-ui.js';

export class GatewayServer {
  private config: ResolvedGatewayConfig;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private connections: ConnectionManager;
  private router: MessageRouter;
  private auth: AuthGuard;
  private startTime: number | null = null;

  // AgentLoop 工厂所需的依赖（通过 setter 注入）
  private llm: LLMClient | null = null;
  private tools: ToolRegistry | null = null;
  private sessionManager: SessionManager | null = null;
  private contextBuilder: ContextBuilder | null = null;
  private tokenCounter: TokenCounter | null = null;
  private summarizer: Summarizer | null = null;
  private agentConfig: AgentConfig | null = null;

  /** 每个连接对应的 AgentLoop 实例（用于事件转发） */
  private agentLoops: Map<string, { loop: AgentLoop; eventStream: EventStream; sessionManager?: SessionManager }> = new Map();

  constructor(config?: GatewayConfig) {
    this.config = {
      port: config?.port ?? 3000,
      host: config?.host ?? '127.0.0.1',
      authToken: config?.authToken ?? '',
      maxConnections: config?.maxConnections ?? 10,
      requestTimeoutMs: config?.requestTimeoutMs ?? 300_000,
      maxMessageSize: config?.maxMessageSize ?? 1_048_576,
    };

    this.connections = new ConnectionManager(this.config.maxConnections);
    this.router = new MessageRouter();
    this.auth = new AuthGuard(this.config.authToken || undefined);

    this.registerBuiltinRoutes();
  }

  // ──── 依赖注入 ────

  /** 设置 LLM 客户端 */
  setLLM(llm: LLMClient): void {
    this.llm = llm;
  }

  /** 设置工具注册中心 */
  setTools(tools: ToolRegistry): void {
    this.tools = tools;
  }

  /** 设置会话管理器 */
  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm;
  }

  /** 设置上下文构建器 */
  setContextBuilder(cb: ContextBuilder): void {
    this.contextBuilder = cb;
  }

  /** 设置 Token 计数器 */
  setTokenCounter(tc: TokenCounter): void {
    this.tokenCounter = tc;
  }

  /** 设置摘要压缩器 */
  setSummarizer(s: Summarizer): void {
    this.summarizer = s;
  }

  /** 设置 Agent 配置模板 */
  setAgentConfig(config: AgentConfig): void {
    this.agentConfig = config;
  }

  // ──── 服务器生命周期 ────

  /**
   * 启动 WebSocket 服务器
   */
  async start(): Promise<void> {
    if (!this.llm || !this.tools) {
      throw new Error('GatewayServer requires LLMClient and ToolRegistry. Call setLLM() and setTools() before start().');
    }

    this.httpServer = createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: this.config.maxMessageSize,
      clientTracking: true,
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    this.startTime = Date.now();

    return new Promise((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        const tokenInfo = this.auth.isEnabled()
          ? `\n[Gateway] Token: ${this.auth.getToken()}`
          : '\n[Gateway] Authentication disabled (no token configured)';
        console.log(`[Gateway] WebSocket server listening on ws://${this.config.host}:${this.config.port}${tokenInfo}`);
        console.log(`[Gateway] Web UI: http://${this.config.host}:${this.config.port}?token=${this.auth.getToken()}`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器（优雅关闭所有连接）
   */
  async stop(): Promise<void> {
    // 清理所有 AgentLoop 的事件监听
    for (const [, { eventStream }] of this.agentLoops) {
      eventStream.removeAllListeners();
    }
    this.agentLoops.clear();

    // 关闭所有 WebSocket 连接
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // 关闭 HTTP 服务器
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connections.unregisterAll();
    this.startTime = null;

    console.log('[Gateway] Server stopped.');
  }

  /**
   * 获取服务器状态
   */
  getStatus(): {
    running: boolean;
    connections: number;
    port: number;
    uptime: number;
  } {
    return {
      running: this.wss !== null,
      connections: this.connections.count(),
      port: this.config.port,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * 获取认证守卫
   */
  getAuthGuard(): AuthGuard {
    return this.auth;
  }

  /**
   * 获取消息路由器（用于注册自定义路由）
   */
  getRouter(): MessageRouter {
    return this.router;
  }

  /**
   * v6.2: 获取设置快照（供 settings.get 路由使用）
   */
  private getSettingsSnapshot(): SettingsSnapshot {
    // 获取权限配置
    const policy = this.getPolicy();
    const permSnapshot = policy && 'getConfig' in policy
      ? (policy as import('../tools/permissions.js').DefaultPermissionPolicy).getConfig()
      : {
        allowedPaths: [],
        extraAllowedPaths: [],
        commandBlacklist: [],
        protectedFiles: [],
      };

    // 获取工具列表
    const toolsList = this.tools?.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    })) || [];

    // 获取网关状态
    const gatewayStatus = this.getStatus();

    // 获取模型信息
    const modelInfo = {
      name: this.llm?.getModel() || 'unknown',
      baseURL: this.llm?.getBaseURL() || 'unknown',
    };

    return {
      workDir: this.agentConfig?.workDir || process.cwd(),
      permissions: permSnapshot,
      tools: toolsList,
      gateway: gatewayStatus,
      model: modelInfo,
    };
  }

  // ──── 连接处理 ────

  /**
   * 处理 HTTP 请求（v5.4: Web UI）
   *
   * GET / → 返回聊天页面 HTML
   * 其他路径 → 404
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // 解析 pathname，忽略查询参数（如 ?token=fc_xxx）
    const pathname = req.url?.split('?')[0] ?? '/';
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = getWebUIHTML();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf-8'),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  /**
   * 处理新的 WebSocket 连接
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const remoteAddr = request.socket.remoteAddress || 'unknown';
    console.log(`[Gateway] Connection attempt from ${remoteAddr}`);

    // 认证检查
    const url = request.url || '';
    if (!this.auth.authenticate(url, request.headers)) {
      ws.close(4001, 'Authentication failed');
      console.log('[Gateway] Connection rejected: authentication failed');
      return;
    }

    // 注册连接
    let ctx: ConnectionContext;
    try {
      ctx = this.connections.register((data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });
    } catch (err: unknown) {
      ws.close(4002, err instanceof Error ? err.message : 'Max connections reached');
      console.log(`[Gateway] Connection rejected: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    console.log(`[Gateway] Client connected: ${ctx.connectionId} (total: ${this.connections.count()})`);

    // 为连接创建 AgentLoop（包裹 try-catch 防止未捕获异常导致连接静默断开）
    try {
      const { loop, eventStream, sessionManager: connSm } = this.createAgentLoopForConnection(ctx);
      this.agentLoops.set(ctx.connectionId, { loop, eventStream, sessionManager: connSm });

      // 将 EventStream 事件转发为 JSON-RPC notification
      this.forwardEvents(ctx, eventStream);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Gateway] Failed to create AgentLoop for ${ctx.connectionId}: ${errMsg}`);
      this.connections.sendTo(ctx.connectionId, JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Internal server error: ' + errMsg },
      }));
      ws.close(1011, errMsg);
      this.connections.unregister(ctx.connectionId);
      return;
    }

    // 处理消息
    ws.on('message', (raw: Buffer) => {
      this.handleMessage(ctx, raw.toString('utf-8')).catch(() => {
        // 错误已在 handleMessage 内部处理
      });
    });

    // 处理关闭
    ws.on('close', () => {
      console.log(`[Gateway] Client disconnected: ${ctx.connectionId}`);
      this.cleanupConnection(ctx.connectionId);
    });

    // 处理错误
    ws.on('error', (err: Error) => {
      console.error(`[Gateway] Error on ${ctx.connectionId}: ${err.message}`);
      this.cleanupConnection(ctx.connectionId);
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleMessage(ctx: ConnectionContext, raw: string): Promise<void> {
    this.connections.touch(ctx.connectionId);

    const response = await this.router.handle(raw, ctx);

    // 通知不需要响应
    if (response !== null) {
      this.connections.sendTo(ctx.connectionId, JSON.stringify(response));
    }
  }

  /**
   * 将 EventStream 事件转发为 JSON-RPC notification
   */
  private forwardEvents(ctx: ConnectionContext, eventStream: EventStream): void {
    for (const [eventType, method] of Object.entries(EVENT_TO_NOTIFICATION_METHOD)) {
      eventStream.on(eventType as import('../utils/event-stream.js').AgentEventType, (e) => {
        if (ctx.busy) {
          // 只在处理请求时转发事件
          this.connections.sendTo(ctx.connectionId, JSON.stringify({
            jsonrpc: '2.0' as const,
            method,
            params: (e as { data?: unknown }).data,
          }));
        }
      });
    }
  }

  // ──── 内置路由 ────

  /**
   * 注册内置 JSON-RPC 路由
   */
  private registerBuiltinRoutes(): void {
    // agent.chat — 发送消息
    this.router.register('agent.chat', async (params, ctx) => {
      const message = params.message as string;
      if (!message) {
        throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'message is required');
      }

      const entry = this.agentLoops.get(ctx.connectionId);
      if (!entry) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'AgentLoop not initialized');
      }

      if (ctx.busy) {
        throw new RouteError(JsonRpcErrorCode.SERVER_BUSY, 'Server is busy processing another request');
      }

      this.connections.setBusy(ctx.connectionId, true);
      try {
        const result = await entry.loop.run(message);
        return { text: result.text, turns: result.turns, toolCalls: result.toolCalls };
      } finally {
        this.connections.setBusy(ctx.connectionId, false);
      }
    });

    // session.list — 列出会话
    this.router.register('session.list', async (_params, ctx) => {
      // 优先使用连接专属的 SessionManager，fallback 到全局
      const sm = this.agentLoops.get(ctx.connectionId)?.sessionManager ?? this.sessionManager;
      if (!sm) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager not configured');
      }
      return sm.listSessions();
    });

    // session.new — 新建会话
    this.router.register('session.new', async (_params, ctx) => {
      const sm = this.agentLoops.get(ctx.connectionId)?.sessionManager ?? this.sessionManager;
      if (!sm || !this.agentConfig) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager or AgentConfig not configured');
      }
      const meta = await sm.create(this.agentConfig.workDir ?? process.cwd());
      this.connections.bindSession(ctx.connectionId, meta.id);

      // 重置连接对应的 AgentLoop 的会话
      const entry = this.agentLoops.get(ctx.connectionId);
      if (entry) {
        entry.loop.resetSession(meta.id);
      }

      return meta;
    });

    // session.resume — 恢复会话
    this.router.register('session.resume', async (params, ctx) => {
      const sessionId = params.sessionId as string;
      if (!sessionId) {
        throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'sessionId is required');
      }
      const sm = this.agentLoops.get(ctx.connectionId)?.sessionManager ?? this.sessionManager;
      if (!sm) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager not configured');
      }

      try {
        const meta = await sm.resume(sessionId);
        this.connections.bindSession(ctx.connectionId, meta.id);

        const entry = this.agentLoops.get(ctx.connectionId);
        if (entry) {
          entry.loop.resetSession(meta.id);
        }

        return meta;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new RouteError(JsonRpcErrorCode.SESSION_NOT_FOUND, message);
      }
    });

    // session.messages — 获取会话消息历史（用于 Web UI 显示）
    this.router.register('session.messages', async (params, ctx) => {
      const sessionId = params.sessionId as string;
      if (!sessionId) {
        throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'sessionId is required');
      }
      const sm = this.agentLoops.get(ctx.connectionId)?.sessionManager ?? this.sessionManager;
      if (!sm) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager not configured');
      }

      const messages = await sm.getMessagesFor(sessionId);
      return { messages };
    });

    // session.delete — 删除会话
    this.router.register('session.delete', async (params, ctx) => {
      const sessionId = params.sessionId as string;
      if (!sessionId) {
        throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'sessionId is required');
      }
      const sm = this.agentLoops.get(ctx.connectionId)?.sessionManager ?? this.sessionManager;
      if (!sm) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager not configured');
      }

      try {
        await sm.deleteSession(sessionId);
        return { success: true, deletedId: sessionId };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, message);
      }
    });

    // session.branch — 创建分支
    this.router.register('session.branch', async (params) => {
      const fromMessageIndex = params.fromMessageIndex as number;
      if (typeof fromMessageIndex !== 'number') {
        throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'fromMessageIndex is required and must be a number');
      }
      if (!this.sessionManager) {
        throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'SessionManager not configured');
      }

      return this.sessionManager.branch(fromMessageIndex);
    });

    // approval.respond — 审批响应
    this.router.register('approval.respond', async (params, ctx) => {
      const approved = params.approved as boolean;
      const entry = this.agentLoops.get(ctx.connectionId);
      if (!entry) {
        return { success: false };
      }

      // 获取审批网关（通过 AgentLoop 的配置）
      // 注意：这里简化处理，直接在 agent.chat 的 busy 期间等待审批
      // 实际的审批流程需要在 EventStream 事件中传递
      return { success: approved };
    });

    // agent.cancel — 取消当前执行（占位，完整实现需要 AbortController）
    this.router.register('agent.cancel', async () => {
      return { success: false, reason: 'Not yet implemented' };
    });

    // gateway.status — 获取网关状态
    this.router.register('gateway.status', async () => {
      return this.getStatus();
    });

    // v6.2: settings.get — 获取当前配置快照
    this.router.register('settings.get', async () => {
      return this.getSettingsSnapshot();
    });

    // v6.2: settings.update — 更新权限配置
    this.router.register('settings.update', async (params) => {
      const { allowedPaths, extraAllowedPaths, protectedFiles, commandBlacklist } = params as Record<string, unknown>;

      // 获取当前 policy 并更新
      const policy = this.getPolicy();
      if (policy) {
        policy.updateConfig({
          allowedPaths: allowedPaths as string[] | undefined,
          extraAllowedPaths: extraAllowedPaths as string[] | undefined,
          protectedFiles: protectedFiles as string[] | undefined,
          commandBlacklist: commandBlacklist as string[] | undefined,
        });
      }

      return { success: true };
    });
  }

  // ──── 私有方法 ────

  /**
   * v6.2: 获取权限策略（供路由使用）
   */
  private getPolicy(): import('../tools/permissions.js').PermissionPolicy | null {
    return this.tools?.getPolicy() ?? null;
  }

  /**
   * 为连接创建独立的 AgentLoop 实例
   */
  private createAgentLoopForConnection(ctx: ConnectionContext): { loop: AgentLoop; eventStream: EventStream; sessionManager?: SessionManager } {
    if (!this.llm || !this.tools || !this.agentConfig) {
      throw new Error('Missing required dependencies for AgentLoop creation');
    }

    // 为每个连接 fork 独立的 SessionManager（共享存储目录，独立会话状态）
    // 避免 CLI 和 Web UI 共享同一个 currentSessionId 导致会话状态冲突
    const connSessionManager = this.sessionManager?.fork();

    const loop = new AgentLoop(this.llm, this.tools, {
      ...this.agentConfig,
      sessionManager: connSessionManager ?? undefined,
      contextBuilder: this.contextBuilder ?? undefined,
      tokenCounter: this.tokenCounter ?? undefined,
      summarizer: this.summarizer ?? undefined,
    });

    const eventStream = loop.getEvents();
    return { loop, eventStream, sessionManager: connSessionManager };
  }

  /**
   * 清理连接资源
   */
  private cleanupConnection(connectionId: string): void {
    const entry = this.agentLoops.get(connectionId);
    if (entry) {
      entry.eventStream.removeAllListeners();
      this.agentLoops.delete(connectionId);
    }
    this.connections.unregister(connectionId);
  }
}
