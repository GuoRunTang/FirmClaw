/**
 * src/audit/types.ts
 *
 * 审计日志类型定义。
 *
 * v4.3: 初始实现
 */

/** 审计事件类型 */
export type AuditEventType =
  | 'tool_execution'      // 工具执行
  | 'approval'            // 人工审批
  | 'prompt_injection'    // 注入检测
  | 'session_start'       // 会话开始
  | 'session_end'         // 会话结束
  | 'config_change';      // 配置变更

/** 审批来源 */
export type ApprovalSource = 'auto' | 'user' | 'timeout' | 'policy';

/** 单条审计记录 */
export interface AuditEntry {
  /** 审计记录唯一 ID（格式：aud_NNN） */
  id: string;
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 关联的会话 ID */
  sessionId?: string;
  /** 事件类型 */
  eventType: AuditEventType;
  /** 工具名称（仅 tool_execution / approval / prompt_injection） */
  toolName?: string;
  /** 工具参数（仅 tool_execution / approval / prompt_injection） */
  args?: Record<string, unknown>;
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 审批来源 */
  approvedBy?: ApprovalSource;
  /** 执行结果 */
  result: string;
  /** 输出摘要（截断到 500 字） */
  output?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
}

/** 审计查询条件 */
export interface AuditFilter {
  /** 按会话 ID 过滤 */
  sessionId?: string;
  /** 按事件类型过滤 */
  eventType?: AuditEventType;
  /** 按工具名过滤 */
  toolName?: string;
  /** 按风险等级过滤 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 按时间范围过滤（ISO 8601） */
  from?: string;
  /** 按时间范围过滤（ISO 8601） */
  to?: string;
  /** 最大返回数量（默认 50） */
  limit?: number;
  /** 是否只看被拒绝的 */
  deniedOnly?: boolean;
}
