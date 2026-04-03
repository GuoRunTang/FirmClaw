/**
 * src/issues/store.ts
 *
 * 问题数据存储：内存缓存 + JSONL 持久化。
 *
 * v1.0: 初始实现 — IssueStore 类
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { IssueRecord, IssueCategory, IssueSeverity } from './types.js';

// ═══════════════════════════════════════════════════════════════
// IssueStore 类
// ═══════════════════════════════════════════════════════════════

export class IssueStore {
  /** 内存中的问题记录，按 sessionId 分组 */
  private records: Map<string, IssueRecord[]> = new Map();

  /** JSONL 持久化目录 */
  private storageDir: string;

  /** 已记录的全局自增序号 */
  private sequence: number = 0;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ?? path.join(os.homedir(), '.firmclaw', 'issues');
    fs.mkdirSync(this.storageDir, { recursive: true });
  }

  /**
   * 记录一条问题。
   * @returns 生成的 IssueRecord（含 id 和 timestamp）
   */
  record(issue: {
    category: IssueCategory;
    subCategory: string;
    severity: IssueSeverity;
    sessionId: string;
    sessionTitle?: string;
    toolName?: string;
    argsSummary?: string;
    description: string;
  }): IssueRecord {
    this.sequence++;
    const id = `iss_${randomUUID().slice(0, 8)}_${this.sequence}`;
    const record: IssueRecord = {
      id,
      category: issue.category,
      subCategory: issue.subCategory,
      severity: issue.severity,
      sessionId: issue.sessionId,
      sessionTitle: issue.sessionTitle,
      toolName: issue.toolName,
      argsSummary: issue.argsSummary,
      description: issue.description,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    // 内存缓存
    const list = this.records.get(record.sessionId);
    if (list) {
      list.push(record);
    } else {
      this.records.set(record.sessionId, [record]);
    }

    // JSONL 追加写入
    this.appendToJsonl(record);

    return record;
  }

  /** 追加写入单条记录到会话的 JSONL 文件 */
  private appendToJsonl(record: IssueRecord): void {
    const filePath = this.getSessionJsonlPath(record.sessionId);
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');
  }

  /** 获取会话的 JSONL 文件路径 */
  getSessionJsonlPath(sessionId: string): string {
    return path.join(this.storageDir, `${sessionId}.jsonl`);
  }

  /** 获取指定会话的所有问题记录 */
  getBySession(sessionId: string): IssueRecord[] {
    return this.records.get(sessionId) ?? [];
  }

  /** 获取所有问题记录 */
  getAll(): IssueRecord[] {
    const all: IssueRecord[] = [];
    for (const list of this.records.values()) {
      all.push(...list);
    }
    return all;
  }

  /** 获取所有会话 ID */
  getSessionIds(): string[] {
    return Array.from(this.records.keys());
  }

  /** 统计指定会话的问题数量 */
  countBySession(sessionId: string): number {
    return (this.records.get(sessionId) ?? []).length;
  }

  /** 统计总问题数 */
  get totalCount(): number {
    let count = 0;
    for (const list of this.records.values()) {
      count += list.length;
    }
    return count;
  }

  /**
   * 标记问题为已解决。
   * @returns 是否找到并更新了记录
   */
  markResolved(issueId: string): boolean {
    for (const list of this.records.values()) {
      const found = list.find(r => r.id === issueId);
      if (found) {
        found.resolved = true;
        return true;
      }
    }
    return false;
  }

  /**
   * 从 JSONL 文件加载指定会话的问题记录到内存。
   * 用于启动时恢复已有数据。
   */
  loadSession(sessionId: string): IssueRecord[] {
    const filePath = this.getSessionJsonlPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records: IssueRecord[] = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line) as IssueRecord;
        records.push(record);
        // 更新序号
        const seq = parseInt(record.id.split('_').pop() ?? '0', 10);
        if (seq > this.sequence) this.sequence = seq;
      } catch {
        // 跳过格式错误的行
      }
    }

    this.records.set(sessionId, records);
    return records;
  }

  /**
   * 加载存储目录下所有 JSONL 文件。
   */
  loadAll(): Map<string, IssueRecord[]> {
    if (!fs.existsSync(this.storageDir)) {
      return this.records;
    }

    const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionId = path.basename(file, '.jsonl');
      this.loadSession(sessionId);
    }
    return this.records;
  }

  /** 获取存储目录路径 */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * 清空指定会话的内存记录（不删除 JSONL 文件）。
   */
  clearSession(sessionId: string): void {
    this.records.delete(sessionId);
  }

  /**
   * 清空所有内存记录。
   */
  clear(): void {
    this.records.clear();
    this.sequence = 0;
  }
}
