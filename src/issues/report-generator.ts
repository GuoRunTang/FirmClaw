/**
 * src/issues/report-generator.ts
 *
 * Markdown 报告生成器：为每个会话生成独立报告 + 全局汇总报告。
 *
 * v1.0: 初始实现 — ReportGenerator 类
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IssueRecord, CategoryStats, IssueSummary } from './types.js';
import { CATEGORY_LABELS } from './types.js';

// ═══════════════════════════════════════════════════════════════
// ReportGenerator 类
// ═══════════════════════════════════════════════════════════════

export class ReportGenerator {
  private outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir;
  }

  /** 设置输出目录 */
  setOutputDir(dir: string): void {
    this.outputDir = dir;
  }

  /**
   * 生成单个会话的 Markdown 报告。
   */
  generateSessionReport(
    sessionId: string,
    records: IssueRecord[],
    options?: { title?: string },
  ): string {
    const title = options?.title ?? '未命名会话';
    const resolved = records.filter(r => r.resolved).length;
    const total = records.length;
    const resolveRate = total > 0 ? ((resolved / total) * 100).toFixed(1) : 'N/A';

    const lines: string[] = [];

    // 标题
    lines.push(`# 会话问题报告`);
    lines.push('');
    lines.push(`> 会话: ${title}`);
    lines.push(`> 会话 ID: \`${sessionId}\``);
    lines.push(`> 生成时间: ${new Date().toISOString()}`);
    lines.push(`> 问题总数: ${total}`);
    lines.push('');

    // 概览
    lines.push(`## 概览`);
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 总问题数 | ${total} |`);
    lines.push(`| 已解决 | ${resolved} |`);
    lines.push(`| 未解决 | ${total - resolved} |`);
    lines.push(`| 解决率 | ${resolveRate}% |`);
    lines.push('');

    if (total === 0) {
      lines.push(`> 该会话未检测到任何问题。`);
      return lines.join('\n');
    }

    // 按分类统计
    const byCategory = aggregateByCategory(records);
    lines.push(`## 按分类统计`);
    lines.push('');
    lines.push(`| 分类 | 数量 | 占比 |`);
    lines.push(`|------|------|------|`);
    for (const cat of byCategory) {
      const pct = ((cat.count / total) * 100).toFixed(1);
      lines.push(`| ${cat.label} (${cat.category}) | ${cat.count} | ${pct}% |`);
    }
    lines.push('');

    // 按严重程度统计
    const bySeverity = countBySeverity(records);
    lines.push(`## 按严重程度统计`);
    lines.push('');
    lines.push(`| 严重程度 | 数量 | 占比 |`);
    lines.push(`|---------|------|------|`);
    const severityLabels: Record<string, string> = { error: '错误', warning: '警告', info: '信息' };
    for (const [sev, count] of Object.entries(bySeverity)) {
      const pct = ((count / total) * 100).toFixed(1);
      lines.push(`| ${severityLabels[sev] ?? sev} | ${count} | ${pct}% |`);
    }
    lines.push('');

    // 问题详情
    lines.push(`## 问题详情`);
    lines.push('');
    let issueIdx = 1;
    for (const record of records) {
      const statusIcon = record.resolved ? '✅ 已解决' : '❌ 未解决';
      lines.push(`### ${record.category}-${String(issueIdx).padStart(3, '0')} | ${record.subCategory} | ${record.toolName ?? '—'}`);
      lines.push(`- **时间**: ${record.timestamp}`);
      lines.push(`- **严重程度**: ${record.severity}`);
      lines.push(`- **描述**: ${escapeMarkdown(record.description.slice(0, 300))}`);
      if (record.argsSummary) {
        lines.push(`- **参数**: \`${escapeMarkdown(record.argsSummary)}\``);
      }
      lines.push(`- **状态**: ${statusIcon}`);
      lines.push('');
      issueIdx++;
    }

    return lines.join('\n');
  }

  /**
   * 生成全局汇总报告。
   */
  generateGlobalSummary(summary: IssueSummary): string {
    const lines: string[] = [];

    lines.push(`# FirmClaw 问题追踪全局汇总`);
    lines.push('');
    lines.push(`> 生成时间: ${new Date().toISOString()}`);
    lines.push(`> 统计范围: ${summary.from} ~ ${summary.to}`);
    lines.push('');

    // 总览
    lines.push(`## 总览`);
    lines.push('');
    lines.push(`| 指标 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 总问题数 | ${summary.totalIssues} |`);
    lines.push(`| 错误 (error) | ${summary.bySeverity.error} |`);
    lines.push(`| 警告 (warning) | ${summary.bySeverity.warning} |`);
    lines.push(`| 信息 (info) | ${summary.bySeverity.info} |`);
    lines.push(`| 解决率 | ${(summary.resolveRate * 100).toFixed(1)}% |`);
    lines.push('');

    if (summary.totalIssues === 0) {
      lines.push(`> 所有会话均未检测到问题。`);
      return lines.join('\n');
    }

    // 按分类排行
    lines.push(`## 分类排行`);
    lines.push('');
    lines.push(`| 排名 | 分类 | 数量 | 占比 |`);
    lines.push(`|------|------|------|------|`);
    summary.byCategory.forEach((cat, idx) => {
      const pct = ((cat.count / summary.totalIssues) * 100).toFixed(1);
      lines.push(`| ${idx + 1} | ${cat.label} (${cat.category}) | ${cat.count} | ${pct}% |`);
    });
    lines.push('');

    // 问题最多的会话
    if (summary.bySession.length > 0) {
      lines.push(`## 问题最多的会话 (Top ${summary.bySession.length})`);
      lines.push('');
      lines.push(`| 排名 | 会话 | 问题数 |`);
      lines.push(`|------|------|--------|`);
      summary.bySession.forEach((s, idx) => {
        lines.push(`| ${idx + 1} | ${s.sessionTitle} (\`${s.sessionId.slice(0, 12)}...\`) | ${s.issueCount} |`);
      });
      lines.push('');
    }

    // 改进建议
    lines.push(`## 改进建议`);
    lines.push('');
    const suggestions = generateSuggestions(summary);
    if (suggestions.length === 0) {
      lines.push(`> 暂无需要改进的领域。`);
    } else {
      suggestions.forEach((s, idx) => {
        lines.push(`${idx + 1}. **[${s.category}] ${s.label}** (${s.count} 次): ${s.suggestion}`);
      });
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * 生成并写入会话报告文件。
   * @returns 写入的文件路径
   */
  writeSessionReport(
    sessionId: string,
    records: IssueRecord[],
    options?: { title?: string },
  ): string {
    if (!this.outputDir) throw new Error('Output directory not set');
    fs.mkdirSync(this.outputDir, { recursive: true });

    const content = this.generateSessionReport(sessionId, records, options);
    const filePath = path.join(this.outputDir, `session-${sessionId}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * 生成并写入全局汇总报告文件。
   * @returns 写入的文件路径
   */
  writeGlobalSummary(summary: IssueSummary): string {
    if (!this.outputDir) throw new Error('Output directory not set');
    fs.mkdirSync(this.outputDir, { recursive: true });

    const content = this.generateGlobalSummary(summary);
    const filePath = path.join(this.outputDir, 'summary.md');
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function aggregateByCategory(records: IssueRecord[]): CategoryStats[] {
  const map = new Map<string, { records: IssueRecord[] }>();
  for (const r of records) {
    const existing = map.get(r.category);
    if (existing) {
      existing.records.push(r);
    } else {
      map.set(r.category, { records: [r] });
    }
  }

  return Array.from(map.entries())
    .map(([category, { records: recs }]) => {
      const subMap = new Map<string, { label: string; count: number; first: string; last: string }>();
      for (const r of recs) {
        const sub = subMap.get(r.subCategory);
        if (sub) {
          sub.count++;
          if (r.timestamp < sub.first) sub.first = r.timestamp;
          if (r.timestamp > sub.last) sub.last = r.timestamp;
        } else {
          subMap.set(r.subCategory, { label: r.subCategory, count: 1, first: r.timestamp, last: r.timestamp });
        }
      }
      return {
        category: category as CategoryStats['category'],
        label: (CATEGORY_LABELS as Record<string, string>)[category] ?? category,
        count: recs.length,
        subCategories: Array.from(subMap.values()),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function countBySeverity(records: IssueRecord[]): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
  for (const r of records) {
    counts[r.severity] = (counts[r.severity] ?? 0) + 1;
  }
  return counts;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[|_*`\\]/g, '\\$&');
}

interface Suggestion {
  category: string;
  label: string;
  count: number;
  suggestion: string;
}

function generateSuggestions(summary: IssueSummary): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const cat of summary.byCategory) {
    const pct = (cat.count / summary.totalIssues) * 100;
    if (pct < 10) continue; // 只关注占比 >= 10% 的分类

    const suggestion = getSuggestion(cat.category);
    if (suggestion) {
      suggestions.push({
        category: cat.category,
        label: cat.label,
        count: cat.count,
        suggestion,
      });
    }
  }

  return suggestions.slice(0, 5); // 最多 5 条建议
}

function getSuggestion(category: string): string | null {
  const map: Record<string, string> = {
    DEP: '检查项目依赖是否完整，内网环境需配置本地镜像源',
    ENCODING: '建议统一使用英文路径，确保系统 locale 为 UTF-8 编码',
    API: '检查 LLM API 端点可达性，考虑增加重试和超时配置',
    TOOL: '工具执行频繁失败，需检查运行环境和工具依赖',
    PERM: '权限拦截较多，可考虑调整权限策略白名单',
    AGENT: '智能体交互存在问题，需优化工具选择和重试策略',
    CONTEXT: '上下文裁剪频繁触发，考虑增加 maxTokens 或启用摘要压缩',
    PARAM: '参数校验失败较多，可优化系统提示词中的工具使用说明',
    ENV: '运行环境存在问题，检查 Node.js 版本和文件系统权限',
    APPROVAL: '审批拒绝较多，可调整风险等级阈值或预授权常用工具',
    HOOK: 'Hook 拦截执行，检查自定义 Hook 规则是否过于严格',
  };
  return map[category] ?? null;
}
