# FirmClaw Phase 6 设计文档

> **状态**: 设计中
> **基于**: v5.0.0 (Phase 1 ~ Phase 5 完成)
> **目标版本**: v6.0.0
> **前置版本**: v5.1.0 → v5.2.0 → v5.3.0 → v5.4.0 → v6.0.0

---

## 一、Phase 6 目标

**让 FirmClaw 具备对外提供服务的能力，从单机 CLI 工具进化为可远程交互的智能体平台。**

当前（v5.0）的系统已经是一个功能完备的本地 CLI 智能体，但存在以下局限：

1. **只能本地 CLI 交互** — 没有远程访问能力，无法在 Web IDE、移动端等场景使用
2. **单会话单线程** — 一次只能处理一个用户请求，无法并发服务多客户端
3. **子任务无编排** — 复杂任务无法拆分给不同专长的子智能体协作
4. **CLI 交互体验有限** — 纯文本输入输出，缺乏富文本、Markdown 渲染等能力

Phase 6 将实现：

1. **WebSocket 服务器** — 基于 `ws` 库实现双向实时通信，支持多客户端连接
2. **消息路由与会话管理** — 每个客户端连接自动映射独立会话，支持会话切换和恢复
3. **子智能体（Subagent）** — 主智能体可创建子智能体执行子任务，结果汇总后返回
4. **CLI 交互界面增强** — 支持富文本输出、Markdown 渲染、进度条等
5. **Web UI（可选）** — 提供一个简单的 Web 界面用于远程交互

---

## 二、设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| WebSocket 库 | **`ws`（npm 包）** | 轻量、标准、生态成熟；不使用 `socket.io` 避免额外抽象层 |
| 传输协议 | **JSON-RPC 2.0 over WebSocket** | 结构化消息格式，天然支持请求/响应/通知三种模式；与现有 EventStream 事件模型契合 |
| 子智能体实现 | **独立 AgentLoop 实例** | 复用现有 AgentLoop，每个子智能体拥有独立的 LLMClient、ToolRegistry、会话上下文；不引入进程/线程隔离（Node.js 单线程）；通过 Promise 等待子任务完成 |
| 子智能体通信 | **回调 + 事件** | 子智能体通过自己的 EventStream 广播进度；父智能体通过 onDelta 回调接收子智能体的实时输出 |
| 会话隔离 | **每连接一会话** | 新的 WebSocket 连接自动创建或恢复会话；通过 `session.id` 在连接间切换 |
| 认证方式 | **Token 认证（Bearer Token）** | WebSocket 握手时通过 URL 参数或 Header 传递 token；简单有效；token 存储在 `~/.firmclaw/config.json` |
| 并发控制 | **每个连接独立 AgentLoop** | 每个连接持有自己的 AgentLoop 实例（共享 LLMClient）；通过连接级锁保证同一连接内请求串行 |
| Web UI | **内嵌静态文件服务** | 使用 Node.js `http` 模块直接 serve 静态 HTML/JS/CSS；不引入前端框架；最小化依赖 |
| 日志同步 | **EventStream → WebSocket 转发** | 服务端订阅 AgentLoop 的 EventStream，将事件序列化为 JSON-RPC notification 推送给客户端 |

---

## 三、模块架构

### 3.1 新增文件总览

```
src/
├── gateway/
│   ├── types.ts                ← [v5.1] JSON-RPC 类型定义
│   ├── server.ts               ← [v5.1] WebSocket 服务器
│   ├── connection.ts           ← [v5.1] 连接管理器（生命周期 + 会话绑定）
│   ├── router.ts               ← [v5.1] 消息路由器（JSON-RPC 分发）
│   └── auth.ts                 ← [v5.1] Token 认证
├── agent/
│   ├── subagent-manager.ts     ← [v5.3] 子智能体管理器
│   └── task-planner.ts         ← [v5.3] 任务分解器（LLM 辅助）
├── cli/
│   ├── renderer.ts             ← [v5.2] 富文本渲染器
│   └── progress.ts             ← [v5.2] 进度条/状态指示器
├── web/
│   └── static/                 ← [v5.4] Web UI 静态文件
│       ├── index.html
│       ├── style.css
│       └── app.js
├── tests/
│   ├── test-ws-server.ts       ← [v5.1]
│   ├── test-ws-router.ts       ← [v5.1]
│   ├── test-subagent.ts        ← [v5.3]
│   └── test-cli-renderer.ts    ← [v5.2]
```

### 3.2 修改文件

```
src/
├── agent/
│   ├── agent-loop.ts           ← [v5.3] 新增 runSubtask() 方法
│   ├── types.ts                ← [v5.3] AgentConfig 新增 subagent 相关配置
│   └── heartbeat.ts            ← [v5.2] 心跳事件支持富文本渲染
├── session/
│   ├── manager.ts              ← [v5.1] 新增 setActiveForConnection() 方法
│   └── types.ts                ← [v5.1] SessionMeta 新增 connectionId 字段
├── utils/
│   └── event-stream.ts         ← [v5.1] 新增 websocket_* 事件类型
├── tools/
│   └── registry.ts             ← [v5.3] 子智能体工具注册（可选）
├── index.ts                    ← [v5.1~v5.4] 新增 /serve、/web 命令；集成 Gateway
└── package.json                ← [v5.1] 新增 ws 依赖
```

### 3.3 架构图

```
                        ┌───────────────────────────────────────────────────────┐
                        │                  多客户端接入层                        │
                        │                                                       │
                        │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
                        │  │ CLI     │  │ Web UI  │  │ VS Code │  │ curl    │  │
                        │  │ (stdin) │  │ (http)  │  │插件    │  │ (ws)    │  │
                        │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  │
                        └───────┼────────────┼────────────┼────────────┼────────┘
                                │            │            │            │
                    ┌───────────┼────────────┼────────────┼────────────┼───────────┐
                    │           ▼            ▼            ▼            ▼           │
                    │          ┌────────────────────────────────────────┐          │
                    │          │           Gateway Layer (v5.1)         │          │
                    │          │                                        │          │
                    │          │  ┌─────────┐  ┌────────┐  ┌────────┐  │          │
                    │          │  │  Auth   │  │ Router │  │ConnMgr │  │          │
                    │          │  │ (Token) │  │(JSON-  │  │(Session│  │          │
                    │          │  │         │  │ RPC)   │  │ Bind)  │  │          │
                    │          │  └─────────┘  └───┬────┘  └────────┘  │          │
                    │          └──────────────────┼────────────────────┘          │
                    │                             │                               │
                    │    ┌────────────────────────┼────────────────────────┐      │
                    │    ▼                        ▼                        ▼      │
                    │  ┌──────────┐  ┌──────────────────┐  ┌──────────────┐     │
                    │  │AgentLoop │  │ SubagentManager  │  │  EventStream │     │
                    │  │(per conn)│  │   (v5.3)         │  │  → WS 转发   │     │
                    │  │          │  │                  │  │              │     │
                    │  │ run()    │  │ spawn(task)     │  │ thinking_    │     │
                    │  │ runSub() │  │ ├─ AgentLoop #1  │  │   delta      │     │
                    │  │          │  │ ├─ AgentLoop #2  │  │ tool_start   │     │
                    │  │          │  │ └─ merge results │  │ tool_end     │     │
                    │  └────┬─────┘  └──────────────────┘  └──────┬───────┘     │
                    │       │                                     │              │
                    │  ┌────┴─────────────────────────────────────┴─────┐        │
                    │  │              复用的 Phase 1~5 组件            │        │
                    │  │                                               │        │
                    │  │  LLMClient  ToolRegistry  SessionManager     │        │
                    │  │  ContextBuilder  Summarizer  MemoryManager   │        │
                    │  │  SearchEngine  AuditLogger  ApprovalGateway  │        │
                    │  │  PromptGuard   HookManager  Heartbeat        │        │
                    │  └───────────────────────────────────────────────┘        │
                    └────────────────────────────────────────────────────────────┘
```

### 3.4 JSON-RPC 2.0 消息格式

所有 WebSocket 通信采用 JSON-RPC 2.0 格式：

```typescript
// 客户端 → 服务端：请求
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

// 服务端 → 客户端：响应
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// 服务端 → 客户端：通知（单向推送）
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}
```

**方法映射**：

| JSON-RPC 方法 | 说明 | 参数 | 返回 |
|---|---|---|---|
| `agent.chat` | 发送消息给智能体 | `{ message: string, sessionId?: string }` | `{ text: string, turns: number, toolCalls: number }` |
| `session.list` | 列出所有会话 | `{}` | `SessionMeta[]` |
| `session.resume` | 恢复会话 | `{ sessionId: string }` | `SessionMeta` |
| `session.new` | 创建新会话 | `{}` | `SessionMeta` |
| `session.branch` | 创建分支 | `{ fromMessageIndex: number }` | `SessionMeta` |
| `command.execute` | 执行斜杠命令 | `{ command: string }` | `string` |
| `approval.respond` | 响应审批请求 | `{ approved: boolean }` | `{ success: boolean }` |
| `agent.cancel` | 取消当前执行 | `{}` | `{ success: boolean }` |

**通知事件映射**（EventStream → JSON-RPC notification）：

| EventStream 事件 | JSON-RPC notification method |
|---|---|
| `thinking_delta` | `agent.thinking` |
| `tool_start` | `agent.tool_start` |
| `tool_end` | `agent.tool_end` |
| `message_end` | `agent.message_end` |
| `error` | `agent.error` |
| `session_start` | `session.started` |
| `context_trimmed` | `agent.context_trimmed` |
| `summary_generated` | `agent.summary_generated` |
| `approval_requested` | `agent.approval_requested` |
| `approval_granted` | `agent.approval_granted` |
| `approval_denied` | `agent.approval_denied` |
| `prompt_injection_detected` | `agent.prompt_injection_detected` |

---

## 四、版本拆分与详细设计

### v5.1.0：WebSocket 网关服务器

**目标**：建立双向实时通信通道，支持多客户端远程交互。

#### 4.1.1 核心设计思路

当前系统的事件驱动架构已经天然适合 WebSocket 场景：

```
当前 CLI 模式：
  User Input → readline → agent.run() → EventStream → console.log

Gateway 模式：
  WebSocket Message → Router → agent.run() → EventStream → WS.send()
```

核心改动是将 `EventStream → console.log` 替换为 `EventStream → WebSocket broadcast`。AgentLoop 本身不需要修改，只需要在 Gateway 层建立连接。

#### 4.1.2 `src/gateway/types.ts` — JSON-RPC 类型

```typescript
/**
 * src/gateway/types.ts
 *
 * JSON-RPC 2.0 类型定义 + Gateway 配置。
 *
 * v5.1: 初始实现
 */

/** JSON-RPC 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/** JSON-RPC 错误 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 通知 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** 标准 JSON-RPC 错误码 */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_BUSY: -32001,     // 自定义：服务端正在处理请求
  AUTH_FAILED: -32002,     // 自定义：认证失败
  SESSION_NOT_FOUND: -32003, // 自定义：会话不存在
} as const;

/** Gateway 配置 */
export interface GatewayConfig {
  /** WebSocket 监听端口（默认 3000） */
  port?: number;
  /** WebSocket 监听主机（默认 '127.0.0.1'） */
  host?: string;
  /** 认证 token（为空则不启用认证） */
  authToken?: string;
  /** 最大并发连接数（默认 10） */
  maxConnections?: number;
  /** 请求超时时间（毫秒，默认 300000） */
  requestTimeoutMs?: number;
  /** 消息最大大小（字节，默认 1MB） */
  maxMessageSize?: number;
}

/** 连接上下文（每个 WebSocket 连接的运行时状态） */
export interface ConnectionContext {
  /** 连接唯一 ID */
  connectionId: string;
  /** 关联的会话 ID */
  sessionId: string | null;
  /** WebSocket 实例 */
  ws: import('ws').WebSocket;
  /** 当前是否正在处理请求 */
  busy: boolean;
  /** 连接创建时间 */
  connectedAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** AgentLoop 实例（每连接独立） */
  agentLoop: import('../agent/agent-loop.js').AgentLoop | null;
}
```

#### 4.1.3 `src/gateway/server.ts` — WebSocket 服务器

```typescript
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
 *
 * v5.1: 初始实现
 */

import type { Server } from 'node:http';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import type { GatewayConfig, ConnectionContext, JsonRpcRequest, JsonRpcResponse } from './types.js';
import { ConnectionManager } from './connection.js';
import { MessageRouter } from './router.js';
import { AuthGuard } from './auth.js';
import crypto from 'node:crypto';

export class GatewayServer {
  private config: Required<GatewayConfig>;
  private wss: WebSocketServer | null = null;
  private connections: ConnectionManager;
  private router: MessageRouter;
  private auth: AuthGuard;
  private httpServer?: Server;

  constructor(config?: GatewayConfig);

  /**
   * 启动 WebSocket 服务器
   */
  async start(): Promise<void>;

  /**
   * 停止服务器（优雅关闭所有连接）
   */
  async stop(): Promise<void>;

  /**
   * 获取服务器状态
   */
  getStatus(): {
    running: boolean;
    connections: number;
    port: number;
    uptime: number;
  };

  /**
   * 处理新的 WebSocket 连接
   */
  private handleConnection(ws: WebSocket, request: import('node:http').IncomingMessage): void;

  /**
   * 处理客户端消息
   */
  private handleMessage(ctx: ConnectionContext, raw: string): void;

  /**
   * 将 EventStream 事件转发为 JSON-RPC notification
   */
  private forwardEvents(ctx: ConnectionContext): void;
}
```

**启动流程**：

```typescript
async start(): Promise<void> {
  this.wss = new WebSocketServer({
    port: this.config.port,
    host: this.config.host,
    maxPayload: this.config.maxMessageSize,
    clientTracking: true,
  });

  this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

  return new Promise((resolve) => {
    this.wss!.on('listening', () => {
      console.log(`[Gateway] WebSocket server listening on ws://${this.config.host}:${this.config.port}`);
      resolve();
    });
  });
}
```

**EventStream 转发**：

```typescript
private forwardEvents(ctx: ConnectionContext): void {
  if (!ctx.agentLoop) return;
  const events = ctx.agentLoop.getEvents();
  const ws = ctx.ws;

  const eventToMethod: Record<string, string> = {
    thinking_delta: 'agent.thinking',
    tool_start: 'agent.tool_start',
    tool_end: 'agent.tool_end',
    message_end: 'agent.message_end',
    error: 'agent.error',
    session_start: 'session.started',
    context_trimmed: 'agent.context_trimmed',
    summary_generated: 'agent.summary_generated',
    approval_requested: 'agent.approval_requested',
    approval_granted: 'agent.approval_granted',
    approval_denied: 'agent.approval_denied',
    prompt_injection_detected: 'agent.prompt_injection_detected',
  };

  for (const [eventType, method] of Object.entries(eventToMethod)) {
    events.on(eventType as any, (e: any) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method,
          params: e.data,
        }));
      }
    });
  }
}
```

#### 4.1.4 `src/gateway/connection.ts` — 连接管理器

```typescript
/**
 * src/gateway/connection.ts
 *
 * 连接管理器 —— 管理 WebSocket 连接的生命周期。
 *
 * v5.1: 初始实现
 */

import type { ConnectionContext } from './types.js';
import type { AgentLoop } from '../agent/agent-loop.js';
import type { SessionManager } from '../session/manager.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { WebSocket } from 'ws';

export class ConnectionManager {
  private connections: Map<string, ConnectionContext>;
  private maxConnections: number;
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager, maxConnections?: number);

  /**
   * 注册新连接
   */
  register(ws: WebSocket): ConnectionContext;

  /**
   * 注销连接（清理资源）
   */
  unregister(connectionId: string): void;

  /**
   * 获取连接
   */
  get(connectionId: string): ConnectionContext | undefined;

  /**
   * 获取所有活跃连接
   */
  getAll(): ConnectionContext[];

  /**
   * 为连接创建/绑定 AgentLoop
   */
  createAgentLoop(
    connectionId: string,
    llm: LLMClient,
    tools: ToolRegistry,
    config: import('../agent/types.js').AgentConfig,
  ): AgentLoop;

  /**
   * 绑定会话到连接
   */
  bindSession(connectionId: string, sessionId: string): void;

  /**
   * 获取连接数
   */
  count(): number;

  /**
   * 广播通知给所有连接
   */
  broadcast(method: string, params?: Record<string, unknown>): void;
}
```

#### 4.1.5 `src/gateway/router.ts` — 消息路由器

```typescript
/**
 * src/gateway/router.ts
 *
 * JSON-RPC 消息路由器 —— 将 method 分发到对应的处理函数。
 *
 * v5.1: 初始实现
 */

import type { JsonRpcRequest, JsonRpcResponse, ConnectionContext } from './types.js';
import { JsonRpcErrorCode } from './types.js';

/** 路由处理函数签名 */
type RouteHandler = (
  params: Record<string, unknown>,
  ctx: ConnectionContext,
) => Promise<unknown>;

export class MessageRouter {
  private routes: Map<string, RouteHandler>;

  constructor();

  /**
   * 注册路由
   */
  register(method: string, handler: RouteHandler): void;

  /**
   * 处理 JSON-RPC 请求
   */
  async handle(
    request: JsonRpcRequest,
    ctx: ConnectionContext,
  ): Promise<JsonRpcResponse>;

  /**
   * 注册内置路由
   */
  private registerBuiltinRoutes(): void;
}
```

**内置路由注册**：

```typescript
private registerBuiltinRoutes(): void {
  // agent.chat — 发送消息
  this.register('agent.chat', async (params, ctx) => {
    const message = params.message as string;
    if (!message) throw new RouteError(JsonRpcErrorCode.INVALID_PARAMS, 'message is required');

    const agent = ctx.agentLoop;
    if (!agent) throw new RouteError(JsonRpcErrorCode.INTERNAL_ERROR, 'AgentLoop not initialized');

    ctx.busy = true;
    try {
      const result = await agent.run(message);
      return { text: result.text, turns: result.turns, toolCalls: result.toolCalls };
    } finally {
      ctx.busy = false;
    }
  });

  // session.list — 列出会话
  this.register('session.list', async (_params, ctx) => {
    // 由外部通过 setDependencies 注入 sessionManager
    return this.sessionManager.listSessions();
  });

  // session.new — 新建会话
  this.register('session.new', async (_params, ctx) => {
    const meta = await this.sessionManager.create(this.workDir);
    ctx.sessionId = meta.id;
    ctx.agentLoop?.resetSession(meta.id);
    return meta;
  });

  // session.resume — 恢复会话
  this.register('session.resume', async (params, ctx) => {
    const sessionId = params.sessionId as string;
    const meta = await this.sessionManager.resume(sessionId);
    ctx.sessionId = meta.id;
    ctx.agentLoop?.resetSession(meta.id);
    return meta;
  });

  // approval.respond — 审批响应
  this.register('approval.respond', async (params, ctx) => {
    const approved = params.approved as boolean;
    const gateway = ctx.agentLoop?.getApprovalGateway();
    if (!gateway || !gateway.hasPending()) {
      return { success: false };
    }
    const success = gateway.resolve(approved ? 'approved' : 'denied');
    return { success };
  });

  // agent.cancel — 取消当前执行
  this.register('agent.cancel', async (_params, ctx) => {
    // 通过设置 maxTurns = 0 来中断下一轮循环
    // 更完善的实现需要 AbortController，留到后续版本
    return { success: false, reason: 'Not yet implemented' };
  });
}
```

#### 4.1.6 `src/gateway/auth.ts` — Token 认证

```typescript
/**
 * src/gateway/auth.ts
 *
 * 简易 Token 认证。
 *
 * v5.1: 初始实现
 */

export class AuthGuard {
  private token: string | null;

  constructor(token?: string);

  /**
   * 验证连接的 token
   *
   * token 传递方式（优先级从高到低）：
   * 1. URL 查询参数：ws://localhost:3000?token=xxx
   * 2. Sec-WebSocket-Protocol Header：在客户端握手时传递
   *
   * 如果未配置 token（authToken 为空），则跳过认证
   */
  authenticate(url: string, headers: import('node:http').IncomingHttpHeaders): boolean;

  /**
   * 生成随机 token（用于首次启动时自动创建）
   */
  static generateToken(): string;
}
```

#### 4.1.7 `src/index.ts` — CLI 集成 Gateway

新增斜杠命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/serve [port]` | 启动 WebSocket 服务器 | `> /serve 3000` |
| `/serve stop` | 停止 WebSocket 服务器 | `> /serve stop` |
| `/serve status` | 查看服务器状态 | `> /serve status` |

新增命令行参数：

```
npx tsx src/index.ts --serve --port 3000   # 直接以服务模式启动
npx tsx src/index.ts --serve --web         # 启动服务 + Web UI
```

初始化代码：

```typescript
// Phase 6: 初始化 Gateway（可选）
let gateway: GatewayServer | null = null;

// 在 handleCommand 中处理 /serve
case '/serve': {
  if (arg === 'stop') {
    if (gateway) {
      await gateway.stop();
      gateway = null;
      console.log('[Gateway] Server stopped.');
    } else {
      console.log('Gateway is not running.');
    }
    break;
  }

  if (arg === 'status') {
    if (gateway) {
      const status = gateway.getStatus();
      console.log(`[Gateway] Running: ws://localhost:${status.port} (${status.connections} connections, uptime: ${Math.round(status.uptime / 1000)}s)`);
    } else {
      console.log('Gateway is not running.');
    }
    break;
  }

  // /serve [port]
  const port = parseInt(arg) || 3000;
  if (!gateway) {
    gateway = new GatewayServer({ port, authToken: undefined });
    await gateway.start();
    console.log(`[Gateway] Server started on ws://localhost:${port}`);
  } else {
    console.log(`Gateway is already running on port ${gateway.getStatus().port}`);
  }
  break;
}
```

#### 4.1.8 测试：`src/tests/test-ws-server.ts`

| 测试用例 | 说明 |
|----------|------|
| 启动服务器 → 连接成功 | 基本 WebSocket 握手 |
| 发送 JSON-RPC 请求 → 收到响应 | agent.chat 方法 |
| 无效 JSON → 错误响应 | PARSE_ERROR |
| 未知方法 → 错误响应 | METHOD_NOT_FOUND |
| Token 认证 | 携带/不携带 token |
| 最大连接数限制 | 超出 maxConnections 时拒绝 |
| 事件转发 | thinking_delta → JSON-RPC notification |
| 连接断开 → 清理资源 | 不会泄漏 AgentLoop 实例 |
| 并发请求串行 | 同一连接 busy 时返回 SERVER_BUSY |

---

### v5.2.0：CLI 交互界面增强

**目标**：改善 CLI 交互体验，支持富文本输出。

#### 4.2.1 `src/cli/renderer.ts` — 富文本渲染器

```typescript
/**
 * src/cli/renderer.ts
 *
 * CLI 富文本渲染器 —— 在终端中渲染 Markdown、代码块、表格等。
 *
 * v5.2: 初始实现
 */

/** 渲染器配置 */
export interface RendererConfig {
  /** 终端宽度（默认 process.stdout.columns） */
  width?: number;
  /** 是否启用颜色（默认 auto-detect） */
  color?: boolean;
  /** 是否启用 Unicode 图标（默认 true） */
  unicode?: boolean;
}

export class Renderer {
  private config: Required<RendererConfig>;

  constructor(config?: RendererConfig);

  /**
   * 渲染 Markdown 文本为终端输出
   *
   * 支持：
   * - # 标题（加粗 + 颜色）
   * - **粗体**
   * - `代码`（反引号，高亮色）
   * - ```代码块```（带语法提示）
   * - - 列表项
   * - > 引用块
   */
  renderMarkdown(text: string): string;

  /**
   * 渲染工具执行信息（增强版 tool_start / tool_end）
   */
  renderToolStart(toolName: string, args: Record<string, unknown>): string;

  /**
   * 渲染工具结果（截断 + 美化）
   */
  renderToolEnd(toolName: string, result: string, isError?: boolean): string;

  /**
   * 渲染审批提示
   */
  renderApprovalPrompt(request: import('../agent/approval-gateway.js').ApprovalRequest): string;

  /**
   * 渲染审计日志条目
   */
  renderAuditEntry(entry: import('../audit/types.js').AuditEntry): string;

  /**
   * 渲染错误信息
   */
  renderError(message: string): string;
}
```

#### 4.2.2 `src/cli/progress.ts` — 进度指示器

```typescript
/**
 * src/cli/progress.ts
 *
 * 终端进度指示器 —— 显示工具执行进度和 Agent 状态。
 *
 * v5.2: 初始实现
 */

export class ProgressIndicator {
  private currentTool: string | null = null;
  private startTime: number = 0;

  /**
   * 开始工具执行计时
   */
  startTool(toolName: string): void;

  /**
   * 结束工具执行计时，返回耗时描述
   */
  endTool(): string;

  /**
   * 显示 Agent 循环状态（第几轮 / 总轮次）
   */
  showTurnProgress(currentTurn: number, maxTurns: number): string;

  /**
   * 显示 Heartbeat 状态
   */
  showHeartbeatStatus(stats: import('../agent/heartbeat.js').HeartbeatStats): string;

  /**
   * 显示搜索状态
   */
  showSearchStatus(query: string, resultCount: number): string;
}
```

#### 4.2.3 CLI 事件渲染改造

在 `src/index.ts` 中，将原始 `console.log` 替换为 `Renderer` 渲染：

```typescript
// Phase 6: 使用 Renderer 美化输出
const renderer = new Renderer({ width: process.stdout.columns || 80 });

events.on('thinking_delta', (e) => {
  process.stdout.write(e.data as string);
});

events.on('tool_start', (e) => {
  const data = e.data as { toolName: string; args: Record<string, unknown> };
  progress.startTool(data.toolName);
  console.log(renderer.renderToolStart(data.toolName, data.args));
});

events.on('tool_end', (e) => {
  const data = e.data as { toolName: string; result: string; isError?: boolean };
  const duration = progress.endTool();
  console.log(renderer.renderToolEnd(data.toolName, data.result, data.isError) + ` (${duration})`);
});
```

#### 4.2.4 测试：`src/tests/test-cli-renderer.ts`

| 测试用例 | 说明 |
|----------|------|
| Markdown 标题渲染 | # → 加粗 + 换行 |
| 代码块渲染 | 保留缩进 + 类型提示 |
| 列表渲染 | 正确缩进 + 列表符号 |
| 工具信息渲染 | 格式化 JSON 参数 |
| 长内容截断 | 超过终端宽度截断 |
| 颜色开关 | color=false 时无 ANSI 转义 |

---

### v5.3.0：子智能体（Subagent）

**目标**：主智能体可将复杂任务拆分给子智能体并行执行，结果汇总后返回。

#### 4.3.1 子智能体架构

```
主 AgentLoop                   子智能体 #1                子智能体 #2
    │                              │                         │
    ├─ LLM: "需要分析两个文件"      │                         │
    │                              │                         │
    ├─ tool_call: subagent_run     │                         │
    │  params: {                    │                         │
    │    task: "分析 auth.ts",      │                         │
    │    tools: ["read_file"],     │                         │
    │    maxTurns: 5               │                         │
    │  }                           │                         │
    │                              │                         │
    ├─ SubagentManager.spawn() ────┤                         │
    │                              ├─ new AgentLoop()        │
    │                              ├─ run("分析 auth.ts")     │
    │                              ├─ tool: read_file         │
    │                              └─ return result ─────────┤
    │                                                        │
    ├─ tool_call: subagent_run                                │
    │  params: { task: "分析 api.ts", ... }                   │
    │                                                        │
    ├─ SubagentManager.spawn() ───────────────────────────────┤
    │                                                        │
    │                              ├─ new AgentLoop()        │
    │                              ├─ run("分析 api.ts")      │
    │                              └─ return result ─────────┤
    │                                                        │
    ├─ merge results                                         │
    ├─ LLM: "综合两个分析结果..."                              │
    └─ final response
```

#### 4.3.2 `src/agent/subagent-manager.ts` — 子智能体管理器

```typescript
/**
 * src/agent/subagent-manager.ts
 *
 * 子智能体管理器 —— 创建、管理和销毁子智能体实例。
 *
 * 设计要点：
 * - 每个子智能体是独立的 AgentLoop 实例
 * - 共享 LLMClient（API 调用复用连接池）
 * - 可配置独立的 ToolRegistry（限制子智能体可用的工具）
 * - 子智能体有自己的 SessionManager（或可选共享）
 * - 子智能体执行结果通过 Promise 返回
 *
 * v5.3: 初始实现
 */

import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig } from './types.js';
import { AgentLoop } from './agent-loop.js';
import type { EventStream } from '../utils/event-stream.js';

/** 子智能体配置 */
export interface SubagentConfig {
  /** 子任务描述（传给子智能体的 prompt） */
  task: string;
  /** 子智能体可用的工具列表（为空则继承全部） */
  allowedTools?: string[];
  /** 最大循环轮次（默认 5，子任务通常较短） */
  maxTurns?: number;
  /** 是否共享父智能体的会话上下文 */
  inheritSession?: boolean;
  /** 子智能体执行超时（毫秒，默认 120000） */
  timeoutMs?: number;
}

/** 子智能体执行结果 */
export interface SubagentResult {
  /** 子智能体唯一 ID */
  subagentId: string;
  /** 任务描述 */
  task: string;
  /** LLM 最终回复 */
  text: string;
  /** 循环轮次 */
  turns: number;
  /** 工具调用次数 */
  toolCalls: number;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 错误信息（如果执行失败） */
  error?: string;
}

export class SubagentManager {
  private parentLlm: LLMClient;
  private parentTools: ToolRegistry;
  private parentConfig: AgentConfig;
  private activeSubagents: Map<string, AgentLoop>;
  private eventStream?: EventStream;

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    config: AgentConfig,
    eventStream?: EventStream,
  );

  /**
   * 创建并执行一个子智能体
   *
   * @param config - 子智能体配置
   * @returns 子智能体执行结果
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult>;

  /**
   * 获取当前活跃的子智能体数量
   */
  getActiveCount(): number;

  /**
   * 终止所有活跃的子智能体
   */
  async terminateAll(): Promise<void>;

  /**
   * 创建子智能体专用的 ToolRegistry
   *
   * 如果指定了 allowedTools，只注册这些工具；
   * 否则继承父智能体的全部工具
   */
  private createSubagentTools(allowedTools?: string[]): ToolRegistry;

  /**
   * 创建子智能体专用的 AgentLoop
   */
  private createSubagentLoop(
    tools: ToolRegistry,
    config: SubagentConfig,
  ): AgentLoop;
}
```

#### 4.3.3 子智能体工具注册

将 `subagent_run` 注册为一个普通工具，让 LLM 可以主动调用：

```typescript
/**
 * 子智能体工具定义
 *
 * 让主智能体通过工具调用的方式创建子智能体。
 * LLM 可以在一次响应中发起多个 subagent_run 调用，
 * 实现任务并行。
 */
export const subagentTool: Tool = {
  name: 'subagent_run',
  description: `创建子智能体执行子任务。适用于需要并行处理多个独立子任务的场景。

使用场景：
- 并行分析多个文件
- 同时执行多个独立查询
- 将大任务拆分为小任务并行处理

注意：
- 子智能体默认只能使用 read_file 工具（只读）
- 如需写入操作，在 allowedTools 中明确指定
- 每个子智能体最多执行 5 轮循环`,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: '子任务描述，明确告诉子智能体需要完成什么',
      },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: '子智能体可用的工具列表（默认只读：["read_file", "bash(只读)"]）',
      },
      maxTurns: {
        type: 'number',
        description: '子智能体最大循环轮次（默认 5）',
      },
    },
    required: ['task'],
  },
  execute: async (params, context) => {
    // 由 SubagentManager 处理
    // context 中注入 subagentManager 引用
  },
};
```

#### 4.3.4 与 AgentLoop 的集成

在 `AgentLoop` 中新增 `runSubtask()` 方法：

```typescript
// src/agent/agent-loop.ts

/**
 * v5.3: 执行子任务（供 SubagentManager 调用）
 *
 * 与 run() 类似，但：
 * - 不自动创建会话（除非配置要求）
 * - 使用子智能体专用的上下文
 * - 可设置更短的超时
 */
async runSubtask(task: string, config?: {
  maxTurns?: number;
  allowedTools?: string[];
  inheritSession?: boolean;
}): Promise<AgentResult> {
  // 复用现有 run() 的核心逻辑
  // 区别在于：不触发自动会话创建、可限制工具
}
```

在 `AgentConfig` 中新增子智能体相关配置：

```typescript
export interface AgentConfig {
  // ... 现有字段 ...

  /** v5.3: 子智能体管理器（可选） */
  subagentManager?: SubagentManager;
  /** v5.3: 最大并行子智能体数量（默认 3） */
  maxSubagents?: number;
}
```

#### 4.3.5 任务分解器（可选增强）

```typescript
/**
 * src/agent/task-planner.ts
 *
 * 任务分解器 —— 使用 LLM 辅助将复杂任务拆分为子任务。
 *
 * v5.3: 可选模块
 */

import type { LLMClient } from '../llm/client.js';
import type { SubagentConfig } from './subagent-manager.js';

/** 分解结果 */
export interface TaskPlan {
  /** 总任务描述 */
  mainTask: string;
  /** 子任务列表 */
  subtasks: SubagentConfig[];
  /** 分解策略说明 */
  strategy: string;
}

export class TaskPlanner {
  private llm: LLMClient;

  constructor(llm: LLMClient);

  /**
   * 分析任务并判断是否需要分解为子任务
   */
  async analyze(task: string): Promise<{
    needsDecomposition: boolean;
    reason: string;
    plan?: TaskPlan;
  }>;

  /**
   * 分解任务为子任务配置
   */
  async decompose(task: string): Promise<TaskPlan>;
}
```

#### 4.3.6 测试：`src/tests/test-subagent.ts`

| 测试用例 | 说明 |
|----------|------|
| 创建子智能体并执行 | 基本功能 |
| 子智能体只读工具限制 | allowedTools 过滤 |
| 子智能体超时 | timeoutMs 生效 |
| 子智能体结果汇总 | 返回正确的 SubagentResult |
| 并行子智能体 | 多个子智能体同时执行 |
| 最大并行数量限制 | 超出 maxSubagents 时排队 |
| 子智能体错误处理 | 子任务失败不影响主智能体 |
| 终止所有子智能体 | terminateAll() 清理 |

---

### v5.4.0：Web UI（可选）+ v6.0.0 整合发布

**目标**：提供一个简单的 Web 界面；全量整合发布 v6.0.0。

#### 4.4.1 Web UI 设计

Web UI 作为 WebSocket 客户端，通过 JSON-RPC 协议与 Gateway 通信。

**技术选型**：
- 纯 HTML + CSS + Vanilla JS（零框架依赖）
- Marked.js（CDN）用于 Markdown 渲染
- Highlight.js（CDN）用于代码高亮

**界面布局**：

```
┌─────────────────────────────────────────────────────────┐
│  FirmClaw Web UI                    [Sessions] [Settings]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│  💬 Session: abc123 | Messages: 42                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [System] Session started                       │   │
│  │                                                 │   │
│  │  [User] 帮我分析这个项目的架构                   │   │
│  │                                                 │   │
│  │  [Agent] 好的，让我来分析项目结构...             │   │
│  │           >>> [bash] {"command":"find . -name "*.ts" -type f"} │
│  │           <<< [bash] src/index.ts ...           │   │
│  │           >>> [read_file] {"path":"src/index.ts"}│   │
│  │           <<< [read_file] ...                   │   │
│  │                                                 │   │
│  │  根据分析，这个项目的核心架构如下：             │   │
│  │  ## 架构概览                                    │   │
│  │  - **AgentLoop**: ReAct 循环核心               │   │
│  │  - **ToolRegistry**: 工具注册中心               │   │
│  │  ...                                             │   │
│  │  [3 turns, 5 tool calls]                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [消息输入框]                        [发送] ⏎   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  📊 活跃连接: 3 | 内存: 128MB | Uptime: 2h  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### 4.4.2 `src/web/static/app.js` — Web 客户端核心

```javascript
/**
 * FirmClaw Web UI 客户端
 *
 * 通过 WebSocket JSON-RPC 与 Gateway 通信。
 */

class FirmClawClient {
  constructor(url) {
    this.ws = null;
    this.url = url;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.eventHandlers = new Map();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
    this.ws.onopen = () => this.emit('connected');
    this.ws.onclose = () => this.emit('disconnected');
  }

  handleMessage(msg) {
    if (msg.id && msg.id !== null) {
      // JSON-RPC Response
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        pending.resolve(msg.error ? Promise.reject(msg.error) : msg.result);
        this.pendingRequests.delete(msg.id);
      }
    } else if (!msg.id && msg.method) {
      // JSON-RPC Notification
      this.emit(msg.method, msg.params);
    }
  }

  async call(method, params = {}) {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 300000);
    });
  }

  async sendChat(message) {
    return this.call('agent.chat', { message });
  }

  async listSessions() {
    return this.call('session.list');
  }

  async newSession() {
    return this.call('session.new');
  }

  async resumeSession(sessionId) {
    return this.call('session.resume', { sessionId });
  }

  async respondApproval(approved) {
    return this.call('approval.respond', { approved });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(h => h(data));
  }
}
```

#### 4.4.3 静态文件服务

Gateway 在启动时可同时提供 HTTP 静态文件服务：

```typescript
// src/gateway/server.ts

async start(): Promise<void> {
  // 启动 HTTP 服务器（用于 WebSocket upgrade + 静态文件）
  const httpServer = createServer(async (req, res) => {
    if (this.serveWebUI && req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await fs.readFile(path.join(__dirname, 'static', 'index.html'), 'utf-8'));
    } else if (this.serveWebUI && req.url?.startsWith('/static/')) {
      // serve CSS/JS files
      const filePath = path.join(__dirname, req.url);
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.css': 'text/css',
        '.js': 'application/javascript',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  // WebSocket attach to HTTP server
  this.wss = new WebSocketServer({ server: httpServer });
  // ...
}
```

#### 4.4.4 v6.0.0 全量整合

**`src/index.ts` 改造**：

```typescript
// Phase 6: 组件初始化
const subagentManager = new SubagentManager(llm, tools, agentConfig, events);

// 注册子智能体工具
tools.register(createSubagentTool(subagentManager));

// 更新 agent 配置
const agent = new AgentLoop(llm, tools, {
  // ... 现有配置 ...
  subagentManager,
  maxSubagents: 3,
});
```

**启动模式**：

```bash
# CLI 模式（默认）
npx tsx src/index.ts

# 服务模式（WebSocket + Web UI）
npx tsx src/index.ts --serve --port 3000 --web

# 仅 WebSocket
npx tsx src/index.ts --serve --port 3000
```

---

## 五、依赖变更

| 依赖 | 版本 | 类型 | 用途 |
|------|------|------|------|
| `ws` | ^8.18.0 | **新增** | WebSocket 服务器 |

**不新增的其他依赖**：
- Web UI 使用纯 Vanilla JS，不引入 React/Vue 等框架
- Markdown 渲染使用 CDN 加载 Marked.js（不打包）
- 代码高亮使用 CDN 加载 Highlight.js（不打包）

---

## 六、目录结构变更（完整 v6.0.0）

```
src/
├── agent/
│   ├── agent-loop.ts          ← v5.3: 新增 runSubtask() 方法
│   ├── types.ts               ← v5.3: AgentConfig 新增 subagentManager / maxSubagents
│   ├── approval-gateway.ts    ← 不变
│   ├── prompt-guard.ts        ← 不变
│   ├── heartbeat.ts           ← 不变
│   ├── subagent-manager.ts    ← v5.3: 新增（子智能体管理器）
│   └── task-planner.ts        ← v5.3: 新增（可选，任务分解器）
├── audit/
│   ├── types.ts               ← 不变
│   ├── logger.ts              ← 不变
│   └── query.ts               ← 不变
├── gateway/
│   ├── types.ts               ← v5.1: 新增（JSON-RPC 类型 + Gateway 配置）
│   ├── server.ts              ← v5.1: 新增（WebSocket 服务器）
│   ├── connection.ts          ← v5.1: 新增（连接管理器）
│   ├── router.ts              ← v5.1: 新增（消息路由器）
│   └── auth.ts                ← v5.1: 新增（Token 认证）
├── cli/
│   ├── renderer.ts            ← v5.2: 新增（富文本渲染器）
│   └── progress.ts            ← v5.2: 新增（进度指示器）
├── llm/
│   └── client.ts              ← 不变
├── session/
│   ├── types.ts               ← 不变
│   ├── store.ts               ← 不变
│   ├── manager.ts             ← v5.1: 新增 setActiveForConnection() 方法
│   ├── context-builder.ts     ← 不变
│   ├── summarizer.ts          ← 不变
│   ├── memory-manager.ts      ← 不变
│   └── search-engine.ts       ← 不变
├── tools/
│   ├── types.ts               ← 不变
│   ├── context.ts             ← 不变
│   ├── registry.ts            ← v5.3: 子智能体工具注册（可选）
│   ├── permissions.ts         ← 不变
│   ├── hook-manager.ts        ← 不变
│   ├── bash.ts                ← 不变
│   ├── read.ts                ← 不变
│   ├── write.ts               ← 不变
│   ├── edit.ts                ← 不变
│   └── subagent.ts            ← v5.3: 新增（子智能体工具定义）
├── utils/
│   ├── event-stream.ts        ← v5.1: 新增 gateway_connected / gateway_disconnected 事件
│   ├── token-counter.ts       ← 不变
│   └── prompt-template.ts     ← 不变
├── web/
│   └── static/                ← v5.4: 新增（Web UI 静态文件）
│       ├── index.html
│       ├── style.css
│       └── app.js
├── tests/
│   ├── test-v1.0-agent.ts     ← Phase 1
│   ├── test-v1.0-bash.ts      ← Phase 1
│   ├── test-v1.0-llm.ts       ← Phase 1
│   ├── test-v1.2-read.ts      ← Phase 2
│   ├── test-v1.3-write.ts     ← Phase 2
│   ├── test-v1.4-edit.ts      ← Phase 2
│   ├── test-v1.5-bash.ts      ← Phase 2
│   ├── test-v1.6-permissions.ts ← Phase 2
│   ├── test-v2.1-session-manager.ts ← Phase 3
│   ├── test-v2.1-session-store.ts   ← Phase 3
│   ├── test-v2.2-context-builder.ts ← Phase 3
│   ├── test-v2.3-token-counter.ts   ← Phase 3
│   ├── test-memory-manager.ts       ← Phase 4
│   ├── test-search-engine.ts        ← Phase 4
│   ├── test-approval-gateway.ts     ← v4.1
│   ├── test-prompt-guard.ts         ← v4.2
│   ├── test-audit-logger.ts         ← v4.3
│   ├── test-heartbeat.ts            ← v4.4
│   ├── test-hook-manager.ts         ← v4.5
│   ├── test-ws-server.ts            ← v5.1 (新增)
│   ├── test-ws-router.ts            ← v5.1 (新增)
│   ├── test-cli-renderer.ts         ← v5.2 (新增)
│   └── test-subagent.ts             ← v5.3 (新增)
└── index.ts                         ← v6.0: 集成全部 Phase 6 模块
```

---

## 七、安全考量

| 风险 | 缓解措施 |
|------|----------|
| WebSocket 未授权访问 | Token 认证（URL 参数或 Header）；未配置 token 时仅监听 127.0.0.1 |
| 恶意客户端大量连接 | maxConnections 限制（默认 10）；连接超时自动断开 |
| 消息炸弹（超大消息） | maxMessageSize 限制（默认 1MB）；ws 库内置 maxPayload |
| JSON-RPC 注入 | 严格校验 JSON-RPC 格式；不执行 eval；method 白名单 |
| 子智能体权限逃逸 | 子智能体默认只读（allowedTools 白名单）；不共享父会话的审批状态 |
| 子智能体无限循环 | maxTurns 限制（默认 5）+ timeoutMs 限制（默认 120s） |
| 审计日志泄露敏感信息 | WebSocket 传输内容不做额外记录；网络层安全由 token 保证 |
| Web UI XSS | 不使用 innerHTML（使用 textContent）；输入内容转义 |
| 多客户端会话冲突 | 每个连接独立 AgentLoop + 独立 SessionManager 实例 |
| WebSocket 连接劫持 | 建议生产环境使用 wss://（TLS）；token 防止未授权连接 |

---

## 八、验证标准

Phase 6 完成后，以下场景必须工作：

```bash
# 1. 启动 WebSocket 服务器
> /serve 3000
[Gateway] WebSocket server listening on ws://127.0.0.1:3000
[Gateway] Token: fc_a1b2c3d4e5f6...

# 2. 客户端连接（使用 wscat）
$ wscat -c ws://localhost:3000?token=fc_a1b2c3d4e5f6...
Connected

# 3. 发送 JSON-RPC 请求
> {"jsonrpc":"2.0","id":1,"method":"agent.chat","params":{"message":"列出当前目录"}}
< {"jsonrpc":"2.0","id":1,"result":{"text":"src/ docs/ package.json ...","turns":1,"toolCalls":1}}
< {"jsonrpc":"2.0","method":"agent.thinking","params":"让我来列出目录..."}
< {"jsonrpc":"2.0","method":"agent.tool_start","params":{"toolName":"bash","args":{"command":"ls"}}}
< {"jsonrpc":"2.0","method":"agent.tool_end","params":{"toolName":"bash","result":"src/ docs/ ..."}}

# 4. 多客户端并发
$ wscat -c ws://localhost:3000?token=fc_a1b2c3d4e5f6...  # 客户端 2
$ wscat -c ws://localhost:3000?token=fc_a1b2c3d4e5f6...  # 客户端 3
# 三个客户端各自有独立会话，互不干扰

# 5. 子智能体
> {"jsonrpc":"2.0","id":2,"method":"agent.chat","params":{"message":"同时分析 src/index.ts 和 src/agent/agent-loop.ts 的代码结构"}}
# LLM 调用 subagent_run 两次，两个子智能体并行执行
< {"jsonrpc":"2.0","method":"agent.tool_start","params":{"toolName":"subagent_run","args":{"task":"分析 index.ts"}}}
< {"jsonrpc":"2.0","method":"agent.tool_start","params":{"toolName":"subagent_run","args":{"task":"分析 agent-loop.ts"}}}
< {"jsonrpc":"2.0","method":"agent.tool_end","params":{"toolName":"subagent_run","result":"..."}}
< {"jsonrpc":"2.0","method":"agent.tool_end","params":{"toolName":"subagent_run","result":"..."}}

# 6. Web UI
$ npx tsx src/index.ts --serve --port 3000 --web
# 浏览器打开 http://localhost:3000
# → 显示聊天界面，可输入消息、查看 Markdown 渲染结果

# 7. CLI 富文本渲染
> 帮我分析代码
[Agent] 好的，让我来分析...
  ▶ [bash] {"command":"find . -name '*.ts' -type f"}
  ✓ [bash] 50 files found (120ms)
  ▶ [read_file] {"path":"src/index.ts"}
  ✓ [read_file] (456 lines) (15ms)
```

---

## 九、断点续开指南

如果会话中断，按以下步骤恢复：

1. 读取本文件：`docs/roadmap-phase6.md`
2. 查看 git log 确认当前进度：`git log --oneline`
3. 查看 git tags：`git tag -l "v5.*"`
4. 找到最新完成的版本号，继续下一个版本的实现
5. 每个版本完成后：写代码 → 跑测试 → git commit + tag → 询问用户

### 当前进度

| 版本 | 内容 | 状态 |
|------|------|------|
| v5.1.0 | WebSocket 网关服务器（GatewayServer + ConnectionManager + MessageRouter + AuthGuard） | ✅ 完成 |
| v5.2.0 | CLI 交互界面增强（Renderer + ProgressIndicator） | ✅ 完成 |
| v5.3.0 | 子智能体（SubagentManager + TaskPlanner） | ⏳ 待开发 |
| v5.4.0 | Web UI（静态文件 + HTTP 服务） | ⏳ 待开发 |
| v6.0.0 | 全量整合 + 版本发布 | ⏳ 待开发 |
