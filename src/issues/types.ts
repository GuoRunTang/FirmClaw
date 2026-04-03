/**
 * src/issues/types.ts
 *
 * 会话问题追踪系统的类型定义。
 *
 * v1.0: 初始实现 — IssueRecord, IssueSummary, IssueCategory 等
 */

/** 问题严重程度 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/** 问题一级分类枚举 */
export type IssueCategory =
  | 'ENV'      // 环境问题
  | 'DEP'      // 依赖问题
  | 'ENCODING' // 编码问题
  | 'API'      // LLM API 问题
  | 'TOOL'     // 工具执行问题
  | 'PERM'     // 权限问题
  | 'APPROVAL' // 审批问题
  | 'PARAM'    // 参数问题
  | 'AGENT'    // 智能体交互问题
  | 'CONTEXT'  // 上下文问题
  | 'HOOK';    // 钩子问题

/** 问题二级细分代码 */
export type IssueSubCategory = string;

/** 分类标签映射 */
export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  ENV:      '环境问题',
  DEP:      '依赖问题',
  ENCODING: '编码问题',
  API:      'LLM API 问题',
  TOOL:     '工具执行问题',
  PERM:     '权限问题',
  APPROVAL: '审批问题',
  PARAM:    '参数问题',
  AGENT:    '智能体交互问题',
  CONTEXT:  '上下文问题',
  HOOK:     '钩子问题',
};

/** 单条问题记录 */
export interface IssueRecord {
  /** 唯一 ID（格式: iss_{uuid 前8位}_{序号}） */
  id: string;
  /** 一级分类代码 */
  category: IssueCategory;
  /** 二级细分代码 */
  subCategory: IssueSubCategory;
  /** 严重程度 */
  severity: IssueSeverity;
  /** 关联的会话 ID */
  sessionId: string;
  /** 会话标题（用于报告可读性） */
  sessionTitle?: string;
  /** 触发问题的工具名称 */
  toolName?: string;
  /** 工具参数摘要（脱敏后） */
  argsSummary?: string;
  /** 错误/问题描述 */
  description: string;
  /** 发生时间（ISO 8601） */
  timestamp: string;
  /** 是否已解决 */
  resolved?: boolean;
}

/** 按二级分类聚合的统计 */
export interface SubCategoryStats {
  subCategory: IssueSubCategory;
  label: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/** 按一级分类聚合的统计 */
export interface CategoryStats {
  category: IssueCategory;
  label: string;
  count: number;
  subCategories: SubCategoryStats[];
}

/** 按会话聚合的统计 */
export interface SessionIssueStats {
  sessionId: string;
  sessionTitle: string;
  issueCount: number;
}

/** 整体汇总摘要 */
export interface IssueSummary {
  /** 统计时间范围起点 */
  from: string;
  /** 统计时间范围终点 */
  to: string;
  /** 总问题数 */
  totalIssues: number;
  /** 按严重程度统计 */
  bySeverity: Record<IssueSeverity, number>;
  /** 按分类统计 */
  byCategory: CategoryStats[];
  /** 按会话统计（top N 问题最多的会话） */
  bySession: SessionIssueStats[];
  /** 解决率 */
  resolveRate: number;
}

/** IssueTracker 配置 */
export interface IssueTrackerConfig {
  /** 问题数据存储目录，默认 ~/.firmclaw/issues */
  storageDir?: string;
  /** 是否启用追踪（默认 true） */
  enabled?: boolean;
}

/** 分类规则 */
export interface ClassificationRule {
  /** 正则匹配模式 */
  pattern: RegExp;
  /** 分类代码 */
  category: IssueCategory;
  /** 二级细分代码 */
  subCategory: IssueSubCategory;
  /** 严重程度 */
  severity: IssueSeverity;
}

/** 分类结果 */
export interface ClassificationResult {
  category: IssueCategory;
  subCategory: IssueSubCategory;
  severity: IssueSeverity;
  label: string;
}
