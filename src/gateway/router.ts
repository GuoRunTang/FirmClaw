/**
 * src/gateway/router.ts
 *
 * JSON-RPC 消息路由器 —— 将 method 分发到对应的处理函数。
 *
 * 设计要点：
 * - 方法白名单机制（只处理已注册的方法）
 * - 自动校验 JSON-RPC 格式
 * - RouteError 用于将业务错误转为 JSON-RPC 错误响应
 * - 依赖通过 setter 注入（SessionManager、AgentLoop 等）
 *
 * v5.1: 初始实现
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ConnectionContext,
  RouteHandler,
} from './types.js';
import { JsonRpcErrorCode, RouteError } from './types.js';

export class MessageRouter {
  /** 方法 → 处理函数的映射表 */
  private routes: Map<string, RouteHandler>;
  /** 已注册的方法列表（用于 METHOD_NOT_FOUND 判断） */
  private methodNames: Set<string>;

  constructor() {
    this.routes = new Map();
    this.methodNames = new Set();
  }

  /**
   * 注册路由
   *
   * @param method - JSON-RPC 方法名
   * @param handler - 处理函数
   */
  register(method: string, handler: RouteHandler): void {
    this.routes.set(method, handler);
    this.methodNames.add(method);
  }

  /**
   * 处理 JSON-RPC 请求
   *
   * 自动完成以下工作：
   * 1. 校验请求格式（jsonrpc、id、method）
   * 2. 查找路由
   * 3. 调用处理函数
   * 4. 捕获异常并返回 JSON-RPC 错误响应
   *
   * @param raw - 原始消息字符串
   * @param ctx - 连接上下文
   * @returns JSON-RPC 响应（如果是通知则返回 null）
   */
  async handle(raw: string, ctx: ConnectionContext): Promise<JsonRpcResponse | null> {
    // ──── 1. 解析 JSON ────
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.errorResponse(null, JsonRpcErrorCode.PARSE_ERROR, 'Parse error');
    }

    // ──── 2. 校验 JSON-RPC 基本格式 ────
    if (parsed.jsonrpc !== '2.0') {
      return this.errorResponse(
        this.extractId(parsed),
        JsonRpcErrorCode.INVALID_REQUEST,
        'Invalid Request: jsonrpc must be "2.0"',
      );
    }

    if (typeof parsed.method !== 'string') {
      return this.errorResponse(
        this.extractId(parsed),
        JsonRpcErrorCode.INVALID_REQUEST,
        'Invalid Request: method must be a string',
      );
    }

    // ──── 3. 区分请求和通知 ────
    const isNotification = parsed.id === undefined;
    const id = isNotification ? null : this.extractId(parsed);
    const method = parsed.method as string;
    const params = (parsed.params as Record<string, unknown>) ?? {};

    // ──── 4. 查找路由 ────
    const handler = this.routes.get(method);
    if (!handler) {
      return this.errorResponse(id, JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: "${method}"`);
    }

    // ──── 5. 执行处理函数 ────
    try {
      const result = await handler(params, ctx);
      // 通知不需要响应
      if (isNotification) return null;
      return this.successResponse(id, result);
    } catch (err: unknown) {
      if (err instanceof RouteError) {
        return this.errorResponse(id, err.code, err.message, err.data);
      }
      const message = err instanceof Error ? err.message : String(err);
      return this.errorResponse(id, JsonRpcErrorCode.INTERNAL_ERROR, message);
    }
  }

  /**
   * 判断方法是否已注册
   */
  hasMethod(method: string): boolean {
    return this.methodNames.has(method);
  }

  /**
   * 获取已注册的方法列表
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.methodNames);
  }

  // ──── 私有方法 ────

  /**
   * 从解析后的 JSON 中提取 id
   */
  private extractId(parsed: Record<string, unknown>): number | string | null {
    if (parsed.id === undefined) return null;
    if (typeof parsed.id === 'number' || typeof parsed.id === 'string') return parsed.id;
    return null;
  }

  /**
   * 构建成功响应
   */
  private successResponse(id: number | string | null, result: unknown): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  /**
   * 构建错误响应
   */
  private errorResponse(
    id: number | string | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
  }
}
