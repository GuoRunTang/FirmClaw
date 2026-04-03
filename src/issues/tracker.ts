/**
 * src/issues/tracker.ts
 *
 * 问题追踪器核心模块：接收来自 Hook 和 EventStream 的事件，
 * 使用 Classifier 分类后通过 Store 持久化。
 *
 * v1.0: 初始实现 — IssueTracker 类
 */

import { IssueClassifier } from './classifier.js';
import { IssueStore } from './store.js';
import type { IssueRecord, IssueTrackerConfig, IssueSummary, CategoryStats, SessionIssueStats } from './types.js';
import type { EventStream, AgentEventType } from '../utils/event-stream.js';

// ═══════════════════════════════════════════════════════════════
// IssueTracker 类
// ═══════════════════════════════════════════════════════════════

export class IssueTracker {
  private classifier: IssueClassifier;
  private store: IssueStore;
  private enabled: boolean;
  private currentSessionId: string | null = null;
  private currentSessionTitle: string | null = null;

  constructor(config?: IssueTrackerConfig) {
    this.classifier = new IssueClassifier();
    this.store = new IssueStore(config?.storageDir);
    this.enabled = config?.enabled ?? true;
  }

  /** 是否启用 */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 启用/禁用追踪 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** 设置当前会话上下文 */
  setSession(sessionId: string, title?: string): void {
    this.currentSessionId = sessionId;
    this.currentSessionTitle = title ?? null;
  }

  /**
   * 从文本自动分类并记录一条问题。
   * 供外部直接调用（如 EventStream 事件处理）。
   */
  recordFromText(text: string, options?: {
    toolName?: string;
    argsSummary?: string;
    sessionId?: string;
    sessionTitle?: string;
  }): IssueRecord | null {
    if (!this.enabled) return null;

    const result = this.classifier.classify(text);
    if (!result) return null;

    return this.store.record({
      category: result.category,
      subCategory: result.subCategory,
      severity: result.severity,
      sessionId: options?.sessionId ?? this.currentSessionId ?? 'unknown',
      sessionTitle: options?.sessionTitle ?? this.currentSessionTitle ?? undefined,
      toolName: options?.toolName,
      argsSummary: options?.argsSummary,
      description: text.slice(0, 500), // 截断过长描述
    });
  }

  /**
   * Hook After 回调函数。
   * 设计用于注册到 hookManager.registerAfter('*', ...)。
   *
   * 检查 ctx.result?.isError 或结果内容中包含错误关键词时记录问题。
   */
  createAfterHook(): (ctx: {
    toolName: string;
    args: Record<string, unknown>;
    result?: { content: string; isError?: boolean };
    toolContext: { sessionId?: string; workDir: string };
    riskLevel?: string;
  }) => void | Promise<void> {
    return (ctx) => {
      if (!this.enabled) return;
      if (!ctx.result) return;

      const content = ctx.result.content ?? '';
      const isError = ctx.result.isError === true;

      // 场景 1: 明确标记为错误
      if (isError) {
        this.recordFromText(content, {
          toolName: ctx.toolName,
          argsSummary: summarizeArgs(ctx.args),
          sessionId: ctx.toolContext?.sessionId ?? undefined,
        });
        return;
      }

      // 场景 2: 内容中包含错误关键词（如 Permission denied、ENOENT 等）
      const classified = this.classifier.classify(content);
      if (classified && classified.severity !== 'info') {
        this.recordFromText(content, {
          toolName: ctx.toolName,
          argsSummary: summarizeArgs(ctx.args),
          sessionId: ctx.toolContext?.sessionId ?? undefined,
        });
      }
    };
  }

  /**
   * 绑定到 EventStream 事件。
   * 监听 error、context_trimmed、approval_denied 等事件。
   */
  bindEvents(events: EventStream): void {
    // 错误事件 — 直接从文本分类
    events.on('error' as AgentEventType, (event) => {
      const msg = String(event?.data ?? '');
      if (msg) {
        this.recordFromText(msg);
      }
    });

    // 上下文裁剪 — 作为 info 级别记录
    events.on('context_trimmed' as AgentEventType, (event) => {
      if (!this.enabled) return;
      const data = event?.data as Record<string, unknown> | undefined;
      const text = `Context trimmed: original=${data?.originalTokens ?? '?'} trimmed=${data?.trimmedTokens ?? '?'}`;
      const result = this.classifier.classify(text);
      if (result) {
        this.store.record({
          category: result.category,
          subCategory: result.subCategory,
          severity: result.severity,
          sessionId: this.currentSessionId ?? 'unknown',
          sessionTitle: this.currentSessionTitle ?? undefined,
          description: text,
        });
      }
    });

    // 审批拒绝
    events.on('approval_denied' as AgentEventType, (event) => {
      if (!this.enabled) return;
      const data = event?.data as Record<string, unknown> | undefined;
      const text = String(data?.reason ?? 'Approval denied');
      this.recordFromText(text, {
        toolName: String(data?.toolName ?? ''),
      });
    });

    // 达到最大轮次
    events.on('agent_status' as AgentEventType, (event) => {
      if (!this.enabled) return;
      const data = event?.data as Record<string, unknown> | undefined;
      if (data?.status === 'max_turns') {
        this.recordFromText('Reached max turns, agent loop stopped', {
          sessionId: this.currentSessionId ?? undefined,
        });
      }
    });
  }

  /** 获取 Store 引用（供报告生成器使用） */
  getStore(): IssueStore {
    return this.store;
  }

  /** 获取 Classifier 引用（供扩展使用） */
  getClassifier(): IssueClassifier {
    return this.classifier;
  }

  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 生成指定会话的问题汇总。
   */
  getSessionSummary(sessionId: string): CategoryStats[] {
    const records = this.store.getBySession(sessionId);
    return aggregateByCategory(records);
  }

  /**
   * 生成全局汇总。
   */
  getGlobalSummary(): IssueSummary {
    const allRecords = this.store.getAll();
    const resolved = allRecords.filter(r => r.resolved).length;
    const total = allRecords.length;

    const bySeverity: Record<string, number> = { error: 0, warning: 0, info: 0 };
    for (const r of allRecords) {
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    }

    const byCategory = aggregateByCategory(allRecords);

    // 按会话统计
    const sessionMap = new Map<string, { title: string; count: number }>();
    for (const r of allRecords) {
      const existing = sessionMap.get(r.sessionId);
      if (existing) {
        existing.count++;
      } else {
        sessionMap.set(r.sessionId, { title: r.sessionTitle ?? 'Untitled', count: 1 });
      }
    }
    const bySession: SessionIssueStats[] = Array.from(sessionMap.entries())
      .map(([sessionId, info]) => ({ sessionId, sessionTitle: info.title, issueCount: info.count }))
      .sort((a, b) => b.issueCount - a.issueCount)
      .slice(0, 20); // top 20

    const timestamps = allRecords.map(r => r.timestamp).sort();

    return {
      from: timestamps[0] ?? new Date().toISOString(),
      to: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      totalIssues: total,
      bySeverity: bySeverity as IssueSummary['bySeverity'],
      byCategory,
      bySession,
      resolveRate: total > 0 ? resolved / total : 0,
    };
  }

  /**
   * 离线扫描 JSONL 会话文件，批量提取问题。
   * @param sessionsDir - 会话 JSONL 文件目录（默认 ~/.firmclaw/sessions）
   */
  async scanSessions(sessionsDir?: string): Promise<{ scanned: number; issuesFound: number }> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const dir = sessionsDir ?? path.join(os.homedir(), '.firmclaw', 'sessions');
    if (!fs.existsSync(dir)) {
      return { scanned: 0, issuesFound: 0 };
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    let scanned = 0;
    let issuesFound = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let sessionId = path.basename(file, '.jsonl');
      let sessionTitle = 'Untitled';

      for (const line of lines) {
        try {
          const msg = JSON.parse(line);

          // 提取 session 元信息
          if (msg.role === '#META' || (msg.id && !msg.role)) {
            sessionId = msg.id ?? sessionId;
            sessionTitle = msg.title ?? sessionTitle;
            continue;
          }

          // 扫描 tool 消息
          if (msg.role === 'tool' && msg.content) {
            const text = String(msg.content);
            const record = this.recordFromText(text, {
              sessionId,
              sessionTitle,
            });
            if (record) {
              issuesFound++;
              // 标记为历史扫描发现（非实时）
              record.resolved = undefined;
            }
          }
        } catch {
          // 跳过格式错误的行
        }
      }
      scanned++;
    }

    return { scanned, issuesFound };
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/** 将工具参数摘要化（脱敏） */
function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';

  const summary: string[] = [];
  for (const key of keys.slice(0, 3)) {
    const val = args[key];
    if (typeof val === 'string') {
      summary.push(`${key}=${val.length > 50 ? val.slice(0, 50) + '...' : val}`);
    } else {
      summary.push(`${key}=...`);
    }
  }
  return summary.join(', ');
}

/** 按一级分类聚合 */
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

  const CATEGORY_LABELS: Record<string, string> = {
    ENV: '环境问题', DEP: '依赖问题', ENCODING: '编码问题',
    API: 'LLM API 问题', TOOL: '工具执行问题', PERM: '权限问题',
    APPROVAL: '审批问题', PARAM: '参数问题', AGENT: '智能体交互问题',
    CONTEXT: '上下文问题', HOOK: '钩子问题',
  };

  return Array.from(map.entries())
    .map(([category, { records: recs }]) => {
      // 按二级分类聚合
      const subMap = new Map<string, { label: string; count: number; first: string; last: string }>();
      for (const r of recs) {
        const sub = subMap.get(r.subCategory);
        if (sub) {
          sub.count++;
          if (r.timestamp < sub.first) sub.first = r.timestamp;
          if (r.timestamp > sub.last) sub.last = r.timestamp;
        } else {
          subMap.set(r.subCategory, {
            label: r.subCategory,
            count: 1,
            first: r.timestamp,
            last: r.timestamp,
          });
        }
      }

      return {
        category: category as CategoryStats['category'],
        label: CATEGORY_LABELS[category] ?? category,
        count: recs.length,
        subCategories: Array.from(subMap.values()),
      };
    })
    .sort((a, b) => b.count - a.count);
}
