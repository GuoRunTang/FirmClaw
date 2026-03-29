/**
 * src/session/manager.ts
 *
 * 会话管理器 —— 封装 SessionStore，对外提供面向业务的 API。
 *
 * 设计要点：
 * - 封装 SessionStore，提供 create / resume / append / list / gc 等方法
 * - 内部维护 metaCache 避免频繁读文件
 * - toLLMMessages() 方法：StoredMessage[] → Message[]（去掉 timestamp）
 *
 * v2.1: 初始实现
 * v3.3: append 时自动更新搜索索引
 * v4.5: 新增 branch() 方法
 */

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import type { Message } from '../llm/client.js';
import type { SessionMeta, StoredMessage, SessionConfig } from './types.js';
import { SessionStore } from './store.js';
import type { SearchEngine } from './search-engine.js';

export class SessionManager {
  private store: SessionStore;
  private currentSessionId: string | null;
  private metaCache: Map<string, SessionMeta>;
  private enabled: boolean;
  private searchEngine?: SearchEngine;

  constructor(config: SessionConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.store = new SessionStore(
      config.storageDir || path.join(os.homedir(), '.firmclaw', 'sessions')
    );
    this.currentSessionId = null;
    this.metaCache = new Map();
  }

  /** 设置搜索引擎（v3.3: append 时自动更新索引） */
  setSearchEngine(engine: SearchEngine): void {
    this.searchEngine = engine;
  }

  /** 是否启用会话持久化 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 生成安全的会话 ID（使用 Node.js 内置 crypto） */
  private generateId(): string {
    return crypto.randomUUID();
  }

  /** 从用户消息生成会话标题（前 50 字） */
  private generateTitle(message: string): string {
    const cleaned = message.replace(/\n/g, ' ').trim();
    if (cleaned.length <= 50) return cleaned;
    return cleaned.slice(0, 47) + '...';
  }

  /** 创建新会话 */
  async create(workDir: string, firstMessage?: string): Promise<SessionMeta> {
    const now = new Date().toISOString();
    const id = this.generateId();

    const meta: SessionMeta = {
      id,
      createdAt: now,
      updatedAt: now,
      workDir,
      title: firstMessage ? this.generateTitle(firstMessage) : '新会话',
      messageCount: 0,
    };

    await this.store.create(meta);
    this.metaCache.set(id, meta);
    this.currentSessionId = id;

    return meta;
  }

  /** 恢复已有会话（读取元数据并设为当前会话） */
  async resume(sessionId: string): Promise<SessionMeta> {
    const meta = await this.store.readMeta(sessionId);
    if (!meta) {
      throw new Error(`Session not found: "${sessionId}"`);
    }

    this.metaCache.set(sessionId, meta);
    this.currentSessionId = sessionId;

    return meta;
  }

  /** 恢复最近一次会话（按 updatedAt 排序） */
  async resumeLatest(): Promise<SessionMeta | null> {
    const sessions = await this.store.listAll();
    if (sessions.length === 0) return null;

    const latest = sessions[0];
    this.currentSessionId = latest.id;
    this.metaCache.set(latest.id, latest);

    return latest;
  }

  /** 向当前会话追加消息（同时更新 meta） */
  async append(messages: StoredMessage[]): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call create() or resume() first.');
    }

    await this.store.appendBatch(this.currentSessionId, messages);

    // v3.3: 自动更新搜索索引
    if (this.searchEngine) {
      for (const msg of messages) {
        this.searchEngine.addDocument({
          id: `${this.currentSessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          source: 'session',
          content: msg.content,
          sessionId: this.currentSessionId,
          timestamp: msg.timestamp,
        });
      }
    }

    // 更新缓存中的元数据 + 同步写磁盘（避免并发 updateMeta 竞态）
    const cached = this.metaCache.get(this.currentSessionId);
    if (cached) {
      cached.updatedAt = new Date().toISOString();
      cached.messageCount += messages.length;
      try {
        await this.store.updateMeta(this.currentSessionId, {
          updatedAt: cached.updatedAt,
          messageCount: cached.messageCount,
        });
      } catch {
        // 静默失败 —— meta 会在下次 resumeLatest 时同步
      }
    }
  }

  /** 获取当前会话的完整 LLM 消息数组（StoredMessage → Message） */
  async getMessages(): Promise<Message[]> {
    if (!this.currentSessionId) return [];

    const stored = await this.store.readMessages(this.currentSessionId);
    return stored.map(toLLMMessage);
  }

  /** 列出所有会话（按 updatedAt 降序） */
  async listSessions(): Promise<SessionMeta[]> {
    return this.store.listAll();
  }

  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /** 获取当前会话元数据（缓存优先） */
  getCurrentMeta(): SessionMeta | null {
    if (!this.currentSessionId) return null;
    return this.metaCache.get(this.currentSessionId) ?? null;
  }

  /** 清理过期会话（超过 N 天，默认 30 天） */
  async gc(maxAgeDays: number = 30): Promise<number> {
    const sessions = await this.store.listAll();
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const session of sessions) {
      const age = now - new Date(session.updatedAt).getTime();
      if (age > maxAgeMs) {
        await this.store.delete(session.id);
        this.metaCache.delete(session.id);
        removed++;
      }
    }

    // 如果当前会话被清理，重置
    if (this.currentSessionId && !this.metaCache.has(this.currentSessionId)) {
      this.currentSessionId = null;
    }

    return removed;
  }

  /** 删除指定会话 */
  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
    this.metaCache.delete(sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
  }

  /** 切换到指定会话（不读取历史，仅设置 ID） */
  switchSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /** 手动更新指定会话的元数据（写磁盘） */
  async updateSessionMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void> {
    await this.store.updateMeta(sessionId, meta);
    const cached = this.metaCache.get(sessionId);
    if (cached) {
      Object.assign(cached, meta);
    }
  }

  /**
   * v4.5: 从当前会话的指定消息处创建分支
   *
   * @param fromMessageIndex - 从第几条消息开始分叉（0-based）
   * @param newTitle - 分支会话标题（可选，默认为 "Branch from [parent]"）
   * @returns 新会话的元数据
   */
  async branch(fromMessageIndex: number, newTitle?: string): Promise<SessionMeta> {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call create() or resume() first.');
    }

    // 从存储读取实际消息数（metaCache 可能不准确）
    const messages = await this.store.readMessages(this.currentSessionId);
    const totalMessages = messages.length;
    const actualIndex = Math.min(Math.max(0, fromMessageIndex), totalMessages);

    const now = new Date().toISOString();
    const parentMeta = this.metaCache.get(this.currentSessionId);
    const workDir = parentMeta?.workDir ?? process.cwd();
    const id = this.generateId();

    const branchMeta: SessionMeta = {
      id,
      createdAt: now,
      updatedAt: now,
      workDir,
      title: newTitle ?? `Branch from ${this.currentSessionId.slice(0, 8)}`,
      messageCount: actualIndex,
      parentSessionId: this.currentSessionId,
      branchPoint: actualIndex,
    };

    await this.store.branchFrom(this.currentSessionId, branchMeta, actualIndex);
    this.metaCache.set(id, branchMeta);

    return branchMeta;
  }

  /**
   * v4.5: 列出指定会话的所有分支
   */
  async listBranches(sessionId?: string): Promise<SessionMeta[]> {
    const targetId = sessionId ?? this.currentSessionId;
    if (!targetId) return [];

    const allSessions = await this.store.listAll();
    return allSessions.filter(s => s.parentSessionId === targetId);
  }
}

/**
 * 将 StoredMessage 转换为 LLM Message（去掉 timestamp 字段）
 *
 * LLM 不需要 timestamp，它是 FirmClaw 内部的存储字段。
 */
function toLLMMessage(stored: StoredMessage): Message {
  const message: Message = {
    role: stored.role,
    content: stored.content,
  };

  if (stored.tool_call_id) {
    message.tool_call_id = stored.tool_call_id;
  }

  if (stored.tool_calls) {
    message.tool_calls = stored.tool_calls;
  }

  return message;
}
