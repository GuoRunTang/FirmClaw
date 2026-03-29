/**
 * src/gateway/connection.ts
 *
 * 连接管理器 —— 管理 WebSocket 连接的生命周期。
 *
 * 设计要点：
 * - 每个连接分配唯一 ID（格式：conn_NNN）
 * - 维护连接上下文（会话绑定、忙碌状态）
 * - 连接数限制（防止资源耗尽）
 * - 广播通知能力
 *
 * v5.1: 初始实现
 */

import type { ConnectionContext } from './types.js';

/** 发送函数类型（解耦 WebSocket 依赖） */
export type SendFn = (data: string) => void;

export class ConnectionManager {
  /** 所有活跃连接 */
  private connections: Map<string, { ctx: ConnectionContext; send: SendFn }>;
  /** 最大并发连接数 */
  private maxConnections: number;
  /** 连接 ID 计数器 */
  private nextId: number;

  constructor(maxConnections?: number) {
    this.connections = new Map();
    this.maxConnections = maxConnections ?? 10;
    this.nextId = 1;
  }

  /**
   * 注册新连接
   *
   * @param send - 发送消息的回调函数（由 Server 层注入）
   * @returns 新连接的上下文
   * @throws 超出最大连接数时抛出 Error
   */
  register(send: SendFn): ConnectionContext {
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`Maximum connections reached (${this.maxConnections})`);
    }

    const connectionId = `conn_${this.nextId++}`;
    const now = new Date().toISOString();

    const ctx: ConnectionContext = {
      connectionId,
      sessionId: null,
      busy: false,
      connectedAt: now,
      lastActiveAt: now,
    };

    this.connections.set(connectionId, { ctx, send });
    return ctx;
  }

  /**
   * 注销连接（清理资源）
   */
  unregister(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  /**
   * 获取连接上下文
   */
  get(connectionId: string): ConnectionContext | undefined {
    return this.connections.get(connectionId)?.ctx;
  }

  /**
   * 获取所有活跃连接的上下文
   */
  getAll(): ConnectionContext[] {
    return Array.from(this.connections.values()).map(entry => entry.ctx);
  }

  /**
   * 获取连接数
   */
  count(): number {
    return this.connections.size;
  }

  /**
   * 绑定会话到连接
   */
  bindSession(connectionId: string, sessionId: string): void {
    const entry = this.connections.get(connectionId);
    if (entry) {
      entry.ctx.sessionId = sessionId;
    }
  }

  /**
   * 设置连接的忙碌状态
   */
  setBusy(connectionId: string, busy: boolean): void {
    const entry = this.connections.get(connectionId);
    if (entry) {
      entry.ctx.busy = busy;
    }
  }

  /**
   * 更新连接的最后活跃时间
   */
  touch(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (entry) {
      entry.ctx.lastActiveAt = new Date().toISOString();
    }
  }

  /**
   * 向指定连接发送消息
   *
   * @returns true = 发送成功，false = 连接不存在
   */
  sendTo(connectionId: string, data: string): boolean {
    const entry = this.connections.get(connectionId);
    if (!entry) return false;

    try {
      entry.send(data);
      return true;
    } catch {
      // 发送失败（连接可能已断开）
      return false;
    }
  }

  /**
   * 广播通知给所有连接
   */
  broadcast(method: string, params?: Record<string, unknown>): void {
    const message = JSON.stringify({
      jsonrpc: '2.0' as const,
      method,
      params,
    });

    for (const [, entry] of this.connections) {
      try {
        entry.send(message);
      } catch {
        // 发送失败，跳过该连接
      }
    }
  }

  /**
   * 获取最大连接数配置
   */
  getMaxConnections(): number {
    return this.maxConnections;
  }

  /**
   * 注销所有连接（优雅关闭）
   */
  unregisterAll(): void {
    this.connections.clear();
    this.nextId = 1;
  }
}
