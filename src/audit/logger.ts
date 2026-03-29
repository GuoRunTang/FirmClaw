/**
 * src/audit/logger.ts
 *
 * 审计日志记录器 —— append-only JSONL 写入。
 *
 * 设计要点：
 * - 每条记录一行 JSON（JSONL 格式），便于追加和流式读取
 * - 自动生成自增 ID 和时间戳
 * - 输出内容自动截断到 500 字，避免日志膨胀
 * - 自动创建目录和文件
 *
 * v4.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AuditEntry } from './types.js';

/** 默认审计文件目录 */
const DEFAULT_AUDIT_DIR = path.join(os.homedir(), '.firmclaw');
/** 默认审计文件名 */
const AUDIT_FILE = 'audit.jsonl';
/** 输出摘要最大长度 */
const MAX_OUTPUT_LENGTH = 500;

export class AuditLogger {
  private filePath: string;
  private seq: number;
  private initialized: boolean = false;

  constructor(auditDir?: string) {
    const dir = auditDir ?? DEFAULT_AUDIT_DIR;
    this.filePath = path.join(dir, AUDIT_FILE);
    this.seq = 0;
  }

  /**
   * 记录一条审计日志
   *
   * @param entry - 审计条目（不含 id 和 timestamp，由日志器自动填充）
   * @returns 生成的审计 ID
   */
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<string> {
    await this.ensureFile();

    const id = this.nextId();
    const timestamp = new Date().toISOString();

    // 截断输出内容
    let output: string | undefined;
    if (entry.output) {
      output = entry.output.length > MAX_OUTPUT_LENGTH
        ? entry.output.slice(0, MAX_OUTPUT_LENGTH) + '...[truncated]'
        : entry.output;
    }

    const record: AuditEntry = {
      ...entry,
      id,
      timestamp,
      ...(output !== undefined && { output }),
    };

    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(this.filePath, line, 'utf-8');

    return id;
  }

  /**
   * 批量记录审计日志
   *
   * @param entries - 多条审计条目
   * @returns 生成的审计 ID 列表
   */
  async logBatch(entries: Omit<AuditEntry, 'id' | 'timestamp'>[]): Promise<string[]> {
    if (entries.length === 0) return [];

    await this.ensureFile();

    const lines: string[] = [];
    const ids: string[] = [];

    for (const entry of entries) {
      const id = this.nextId();
      const timestamp = new Date().toISOString();

      let output: string | undefined;
      if (entry.output) {
        output = entry.output.length > MAX_OUTPUT_LENGTH
          ? entry.output.slice(0, MAX_OUTPUT_LENGTH) + '...[truncated]'
          : entry.output;
      }

      const record: AuditEntry = {
        ...entry,
        id,
        timestamp,
        ...(output !== undefined && { output }),
      };

      ids.push(id);
      lines.push(JSON.stringify(record));
    }

    await fs.appendFile(this.filePath, lines.join('\n') + '\n', 'utf-8');

    return ids;
  }

  /**
   * 获取审计文件路径（供 AuditQuery 使用）
   */
  getFilePath(): string {
    return this.filePath;
  }

  /** 生成审计 ID（格式：aud_NNN） */
  private nextId(): string {
    this.seq++;
    return `aud_${String(this.seq).padStart(3, '0')}`;
  }

  /** 确保目录和文件存在；初始化时读取已有记录数以续接 seq */
  private async ensureFile(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      // 尝试读取已有行数来续接 seq
      try {
        const content = await fs.readFile(this.filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        this.seq = lines.length;
      } catch {
        // 文件不存在，seq 保持 0
      }
      this.initialized = true;
    } catch (err) {
      throw new Error(`Failed to initialize audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
