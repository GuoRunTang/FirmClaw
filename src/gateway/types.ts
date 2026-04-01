/**
 * src/gateway/types.ts
 *
 * JSON-RPC 2.0 类型定义 + Gateway 配置。
 *
 * 所有 WebSocket 通信均采用 JSON-RPC 2.0 协议格式，
 * 天然支持请求/响应/通知三种消息模式。
 *
 * v5.1: 初始实现
 */

import type { AgentEventType } from '../utils/event-stream.js';

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 核心类型
// ═══════════════════════════════════════════════════════════════

/** JSON-RPC 请求（客户端 → 服务端） */
export interface JsonRpcRequest {
  /** 协议版本，固定为 '2.0' */
  jsonrpc: '2.0';
  /** 请求 ID（用于匹配响应） */
  id: number | string;
  /** 方法名 */
  method: string;
  /** 方法参数（可选） */
  params?: Record<string, unknown>;
}

/** JSON-RPC 响应（服务端 → 客户端） */
export interface JsonRpcResponse {
  /** 协议版本，固定为 '2.0' */
  jsonrpc: '2.0';
  /** 对应的请求 ID（错误时可能为 null） */
  id: number | string | null;
  /** 成功时的返回值 */
  result?: unknown;
  /** 错误信息（与 result 互斥） */
  error?: JsonRpcError;
}

/** JSON-RPC 错误对象 */
export interface JsonRpcError {
  /** 错误码 */
  code: number;
  /** 错误描述 */
  message: string;
  /** 附加数据（可选） */
  data?: unknown;
}

/** JSON-RPC 通知（服务端 → 客户端，单向推送，无 id） */
export interface JsonRpcNotification {
  /** 协议版本，固定为 '2.0' */
  jsonrpc: '2.0';
  /** 通知方法名 */
  method: string;
  /** 通知参数（可选） */
  params?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 标准 JSON-RPC 错误码
// ═══════════════════════════════════════════════════════════════

/** JSON-RPC 标准错误码 + 自定义错误码 */
export const JsonRpcErrorCode = {
  /** 解析错误（无效 JSON） */
  PARSE_ERROR: -32700,
  /** 无效请求（不符合 JSON-RPC 规范） */
  INVALID_REQUEST: -32600,
  /** 方法不存在 */
  METHOD_NOT_FOUND: -32601,
  /** 无效参数 */
  INVALID_PARAMS: -32602,
  /** 内部错误 */
  INTERNAL_ERROR: -32603,
  /** 自定义：服务端正在处理请求（同一连接并发限制） */
  SERVER_BUSY: -32001,
  /** 自定义：认证失败 */
  AUTH_FAILED: -32002,
  /** 自定义：会话不存在 */
  SESSION_NOT_FOUND: -32003,
} as const;

// ═══════════════════════════════════════════════════════════════
// Gateway 配置
// ═══════════════════════════════════════════════════════════════

/** Gateway 服务器配置 */
export interface GatewayConfig {
  /** WebSocket 监听端口（默认 3000） */
  port?: number;
  /** WebSocket 监听主机（默认 '127.0.0.1'） */
  host?: string;
  /** 认证 token（为空则不启用认证） */
  authToken?: string;
  /** 最大并发连接数（默认 10） */
  maxConnections?: number;
  /** 请求超时时间（毫秒，默认 300000 = 5 分钟） */
  requestTimeoutMs?: number;
  /** 消息最大大小（字节，默认 1048576 = 1MB） */
  maxMessageSize?: number;
}

/** GatewayConfig 的完整版本（所有字段必填） */
export type ResolvedGatewayConfig = Required<GatewayConfig>;

// ═══════════════════════════════════════════════════════════════
// 连接上下文
// ═══════════════════════════════════════════════════════════════

/** 每个 WebSocket 连接的运行时状态 */
export interface ConnectionContext {
  /** 连接唯一 ID（格式：conn_NNN） */
  connectionId: string;
  /** 关联的会话 ID */
  sessionId: string | null;
  /** 当前是否正在处理请求 */
  busy: boolean;
  /** 连接创建时间（ISO 8601） */
  connectedAt: string;
  /** 最后活跃时间（ISO 8601） */
  lastActiveAt: string;
}

// ═══════════════════════════════════════════════════════════════
// 事件映射
// ═══════════════════════════════════════════════════════════════

/** EventStream 事件类型 → JSON-RPC notification method 的映射 */
export const EVENT_TO_NOTIFICATION_METHOD: Record<AgentEventType, string> = {
  thinking_delta: 'agent.thinking',
  tool_start: 'agent.tool_start',
  tool_end: 'agent.tool_end',
  message_end: 'agent.message_end',
  error: 'agent.error',
  session_start: 'session.started',
  context_trimmed: 'agent.context_trimmed',
  summary_generated: 'agent.summary_generated',
  memory_saved: 'agent.memory_saved',
  approval_requested: 'agent.approval_requested',
  approval_granted: 'agent.approval_granted',
  approval_denied: 'agent.approval_denied',
  prompt_injection_detected: 'agent.prompt_injection_detected',
};

// ═══════════════════════════════════════════════════════════════
// 路由处理
// ═══════════════════════════════════════════════════════════════

/** 路由处理函数签名 */
export type RouteHandler = (
  params: Record<string, unknown>,
  ctx: ConnectionContext,
) => Promise<unknown>;

/** 路由处理抛出的错误（用于区分普通 Error 和需要返回给客户端的错误） */
export class RouteError extends Error {
  /** JSON-RPC 错误码 */
  code: number;
  /** 附加数据 */
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    this.data = data;
  }
}

// ═══════════════════════════════════════════════════════════════
// v6.2: 设置快照（settings.get 响应）
// ═══════════════════════════════════════════════════════════════

import type { PermissionSnapshot } from '../tools/permissions.js';

/** Web UI 设置页面展示的配置快照 */
export interface SettingsSnapshot {
  /** 工作目录 */
  workDir: string;
  /** 权限配置快照 */
  permissions: PermissionSnapshot;
  /** 已注册工具列表（名称 + 描述 + 参数 schema） */
  tools: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  /** 网关状态 */
  gateway: {
    running: boolean;
    connections: number;
    port: number;
    uptime: number;
  };
  /** 模型信息 */
  model: {
    name: string;
    baseURL: string;
  };
}
