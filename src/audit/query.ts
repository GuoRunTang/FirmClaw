/**
 * src/audit/query.ts
 *
 * 审计日志查询器 —— 支持按条件过滤、聚合统计和 CSV 导出。
 *
 * 设计要点：
 * - 读取 JSONL 文件，逐行解析
 * - 损坏行容错（跳过非法 JSON）
 * - 查询结果按时间倒序
 * - CSV 导出包含所有审计字段
 *
 * v4.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AuditEntry, AuditFilter } from './types.js';

/** 默认审计文件目录 */
const DEFAULT_AUDIT_DIR = path.join(os.homedir(), '.firmclaw');
/** 默认审计文件名 */
const AUDIT_FILE = 'audit.jsonl';

export class AuditQuery {
  private filePath: string;

  constructor(auditDir?: string) {
    const dir = auditDir ?? DEFAULT_AUDIT_DIR;
    this.filePath = path.join(dir, AUDIT_FILE);
  }

  /**
   * 使用自定义文件路径（与 AuditLogger 共享）
   */
  setFilePath(filePath: string): void {
    this.filePath = filePath;
  }

  /**
   * 按条件查询审计记录
   *
   * @param filter - 过滤条件
   * @returns 匹配的审计记录（按时间倒序）
   */
  async query(filter?: AuditFilter): Promise<AuditEntry[]> {
    let entries = await this.readAll();

    if (filter) {
      entries = this.applyFilter(entries, filter);
    }

    // 按时间倒序
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 限制数量
    if (filter?.limit && filter.limit > 0) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }

  /**
   * 获取统计摘要
   */
  async stats(): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
    byTool: Record<string, number>;
    byRiskLevel: Record<string, number>;
    totalDurationMs: number;
    deniedCount: number;
  }> {
    const entries = await this.readAll();

    const byType: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};
    let totalDurationMs = 0;
    let deniedCount = 0;

    for (const entry of entries) {
      // 按类型统计
      byType[entry.eventType] = (byType[entry.eventType] ?? 0) + 1;

      // 按工具统计
      if (entry.toolName) {
        byTool[entry.toolName] = (byTool[entry.toolName] ?? 0) + 1;
      }

      // 按风险等级统计
      if (entry.riskLevel) {
        byRiskLevel[entry.riskLevel] = (byRiskLevel[entry.riskLevel] ?? 0) + 1;
      }

      // 累计耗时
      if (entry.durationMs) {
        totalDurationMs += entry.durationMs;
      }

      // 被拒绝计数
      if (entry.result === 'denied' || entry.result === 'rejected') {
        deniedCount++;
      }
    }

    return {
      totalEntries: entries.length,
      byType,
      byTool,
      byRiskLevel,
      totalDurationMs,
      deniedCount,
    };
  }

  /**
   * 导出为 CSV 格式
   *
   * @param filter - 可选过滤条件
   * @returns CSV 字符串
   */
  async exportCSV(filter?: AuditFilter): Promise<string> {
    const entries = await this.query(filter);

    // CSV 表头
    const headers = [
      'id', 'timestamp', 'sessionId', 'eventType', 'toolName',
      'riskLevel', 'approvedBy', 'result', 'durationMs', 'output',
    ];

    const rows = entries.map(entry => {
      // 转义 CSV 中的双引号和换行
      const esc = (val: unknown): string => {
        const s = val === undefined || val === null ? '' : String(val);
        return `"${s.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      };

      return [
        esc(entry.id),
        esc(entry.timestamp),
        esc(entry.sessionId),
        esc(entry.eventType),
        esc(entry.toolName),
        esc(entry.riskLevel),
        esc(entry.approvedBy),
        esc(entry.result),
        esc(entry.durationMs),
        esc(entry.output),
      ].join(',');
    });

    return headers.join(',') + '\n' + rows.join('\n');
  }

  /**
   * 读取全部审计记录（容错处理损坏行）
   */
  private async readAll(): Promise<AuditEntry[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      const entries: AuditEntry[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;
          entries.push(entry);
        } catch {
          // 跳过损坏行
        }
      }

      return entries;
    } catch {
      // 文件不存在 → 空数组
      return [];
    }
  }

  /**
   * 应用过滤条件
   */
  private applyFilter(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
    return entries.filter(entry => {
      if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
      if (filter.eventType && entry.eventType !== filter.eventType) return false;
      if (filter.toolName && entry.toolName !== filter.toolName) return false;
      if (filter.riskLevel && entry.riskLevel !== filter.riskLevel) return false;

      if (filter.from) {
        const entryTime = new Date(entry.timestamp).getTime();
        const fromTime = new Date(filter.from).getTime();
        if (entryTime < fromTime) return false;
      }

      if (filter.to) {
        const entryTime = new Date(entry.timestamp).getTime();
        const toTime = new Date(filter.to).getTime();
        if (entryTime > toTime) return false;
      }

      if (filter.deniedOnly) {
        if (entry.result !== 'denied' && entry.result !== 'rejected') return false;
      }

      return true;
    });
  }
}
