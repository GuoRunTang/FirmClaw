/**
 * src/issues/index.ts
 *
 * 会话问题追踪系统 — 公共导出入口。
 */

// 类型
export type {
  IssueSeverity,
  IssueCategory,
  IssueSubCategory,
  IssueRecord,
  SubCategoryStats,
  CategoryStats,
  SessionIssueStats,
  IssueSummary,
  IssueTrackerConfig,
  ClassificationRule,
  ClassificationResult,
} from './types.js';

export { CATEGORY_LABELS } from './types.js';

// 分类器
export { IssueClassifier } from './classifier.js';

// 存储
export { IssueStore } from './store.js';

// 追踪器
export { IssueTracker } from './tracker.js';

// 报告生成器
export { ReportGenerator } from './report-generator.js';
