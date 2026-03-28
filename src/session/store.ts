/**
 * src/session/store.ts
 *
 * JSONL 存储层 —— 会话消息的磁盘读写。
 *
 * 设计要点：
 * - append-only：新消息只追加到文件末尾，不修改历史行
 * - 线程安全：每次写入用 fs.appendFile（原子追加）
 * - 懒加载：readMessages() 时才读取文件，不在内存中缓存全量
 * - 首行元数据：JSONL 文件第一行是 #META 前缀的 SessionMeta
 *
 * 文件格式：
 *   #META {"id":"abc123","createdAt":"...","title":"帮我分析代码"}
 *   {"role":"user","content":"帮我分析代码","timestamp":"..."}
 *   {"role":"assistant","content":"好的...","timestamp":"..."}
 *
 * v2.1: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionMeta, StoredMessage } from './types.js';

/** 会话 ID 合法字符（防止路径遍历） */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const META_PREFIX = '#META ';

export class SessionStore {
  private storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
  }

  /** 确保存储目录存在 */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /** 校验 sessionId 安全性（防止路径遍历攻击） */
  private validateSessionId(sessionId: string): void {
    if (!SESSION_ID_PATTERN.test(sessionId) || sessionId.length > 100) {
      throw new Error(`Invalid session ID: "${sessionId}"`);
    }
  }

  /** 会话文件路径 */
  filePath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.jsonl`);
  }

  /** 创建新会话文件，写入 meta 行 */
  async create(meta: SessionMeta): Promise<void> {
    this.validateSessionId(meta.id);
    await this.ensureDir();

    const metaLine = META_PREFIX + JSON.stringify(meta) + '\n';
    await fs.writeFile(this.filePath(meta.id), metaLine, 'utf-8');
  }

  /** 追加一条消息到会话文件 */
  async append(sessionId: string, message: StoredMessage): Promise<void> {
    this.validateSessionId(sessionId);
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(this.filePath(sessionId), line, 'utf-8');
  }

  /** 批量追加（一轮循环的多条消息） */
  async appendBatch(sessionId: string, messages: StoredMessage[]): Promise<void> {
    if (messages.length === 0) return;
    this.validateSessionId(sessionId);
    const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
    await fs.appendFile(this.filePath(sessionId), content, 'utf-8');
  }

  /** 读取会话的所有消息（跳过 #META 行） */
  async readMessages(sessionId: string): Promise<StoredMessage[]> {
    this.validateSessionId(sessionId);

    try {
      const content = await fs.readFile(this.filePath(sessionId), 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const messages: StoredMessage[] = [];

      for (const line of lines) {
        if (line.startsWith(META_PREFIX)) continue;
        try {
          messages.push(JSON.parse(line) as StoredMessage);
        } catch {
          // 跳过无法解析的行（容错）
        }
      }

      return messages;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /** 读取会话元数据（#META 行） */
  async readMeta(sessionId: string): Promise<SessionMeta | null> {
    this.validateSessionId(sessionId);

    try {
      const content = await fs.readFile(this.filePath(sessionId), 'utf-8');
      const firstLine = content.split('\n')[0];

      if (!firstLine.startsWith(META_PREFIX)) {
        return null;
      }

      return JSON.parse(firstLine.slice(META_PREFIX.length)) as SessionMeta;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** 更新元数据（覆写 #META 行，保留其余消息） */
  async updateMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void> {
    this.validateSessionId(sessionId);

    const currentMeta = await this.readMeta(sessionId);
    if (!currentMeta) {
      throw new Error(`Session not found: "${sessionId}"`);
    }

    const newMeta: SessionMeta = { ...currentMeta, ...meta };
    const metaLine = META_PREFIX + JSON.stringify(newMeta) + '\n';

    // 读取全部内容，替换首行
    const content = await fs.readFile(this.filePath(sessionId), 'utf-8');
    const lines = content.split('\n');
    const restLines = lines.slice(1);
    const newContent = metaLine + restLines.join('\n');

    await fs.writeFile(this.filePath(sessionId), newContent, 'utf-8');
  }

  /** 列出所有会话的元数据（按 updatedAt 降序） */
  async listAll(): Promise<SessionMeta[]> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(this.storageDir);
      const metas: SessionMeta[] = [];

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.slice(0, -6); // 去掉 .jsonl
        const meta = await this.readMeta(sessionId);
        if (meta) {
          metas.push(meta);
        }
      }

      // 按最后活跃时间降序排列
      metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return metas;
    } catch {
      return [];
    }
  }

  /** 删除会话文件 */
  async delete(sessionId: string): Promise<void> {
    this.validateSessionId(sessionId);

    try {
      await fs.unlink(this.filePath(sessionId));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
