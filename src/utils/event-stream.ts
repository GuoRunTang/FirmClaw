/**
 * src/utils/event-stream.ts
 *
 * EventStream 是智能体与外界通信的"广播系统"。
 *
 * 问题：Agent Loop 运行时，CLI 需要实时展示：
 * - LLM 正在想什么（thinking_delta）
 * - 正在执行哪个工具（tool_start）
 * - 工具执行结果是什么（tool_end）
 * - 发生了什么错误（error）
 * - 会话何时开始（session_start）— v2.3
 * - 上下文何时被裁剪（context_trimmed）— v2.3
 * - 摘要何时生成（summary_generated）— v3.1
 * - 记忆何时保存（memory_saved）— v3.2
 * - 审批何时请求/解决（approval_*）— v4.1
 *
 * 解决方案：用事件发布/订阅模式。
 * - Agent Loop 通过 events.emit('xxx', data) 发布事件
 * - CLI 通过 events.on('xxx', callback) 订阅事件
 * - 两者完全解耦，Agent Loop 不需要知道谁在监听
 *
 * v2.3: 新增 session_start / context_trimmed
 * v3.1: 新增 summary_generated
 * v3.2: 新增 memory_saved
 * v4.1: 新增 approval_requested / approval_granted / approval_denied
 * v4.2: 新增 prompt_injection_detected
 * v7.2: 新增 agent_status（丰富状态指示）
 */

import { EventEmitter } from 'node:events';

/**
 * v7.2: Agent 状态类型
 *
 * 参考 Claude Code 的多维度状态反馈，比简单的 busy/idle 更生动。
 * 每种状态都对应 Web UI 中不同的图标、动画和文案。
 */
export type AgentStatusType =
  | 'idle'                     // 空闲，等待用户输入
  | 'thinking'                 // 正在调用 LLM（首次或再次思考）
  | 'analyzing'                // 正在分析工具结果 / 规划下一步
  | 'tool_executing'           // 正在执行工具
  | 'tool_completed'           // 工具执行完成，准备继续
  | 'summarizing'              // 正在生成摘要压缩上下文
  | 'trimming'                 // 正在裁剪上下文
  | 'retrying'                 // API 错误后正在重试
  | 'approving'                // 等待人工审批
  | 'error'                    // 执行出错
  | 'max_turns';               // 达到最大循环轮次

/** 所有事件类型 */
export type AgentEventType =
  | 'thinking_delta'                // LLM 生成的文本片段
  | 'tool_start'                    // 工具开始执行
  | 'tool_end'                      // 工具执行完成
  | 'message_end'                   // 最终文本回复完成
  | 'error'                         // 出错了
  | 'session_start'                 // v2.3: 会话开始 { id, title, createdAt }
  | 'context_trimmed'               // v2.3: 上下文被裁剪 { originalTokens, trimmedTokens }
  | 'summary_generated'             // v3.1: 摘要生成 { compressedCount, originalTokens, newTokens }
  | 'memory_saved'                  // v3.2: 记忆保存 { id, tag }
  | 'approval_requested'            // v4.1: 审批请求 { id, toolName, args, riskLevel }
  | 'approval_granted'              // v4.1: 审批通过 { toolName, args }
  | 'approval_denied'               // v4.1: 审批拒绝 { toolName, args, reason }
  | 'prompt_injection_detected'     // v4.2: 注入检测 { toolName, matchTypes }
  | 'agent_status';                 // v7.2: Agent 状态变更 { status, detail?, toolName? }

/** 事件对象 */
export interface AgentEvent {
  type: AgentEventType;
  data?: unknown;
}

export class EventStream extends EventEmitter {
  /** 发布事件 */
  emit(event: AgentEventType, data?: unknown): boolean {
    return super.emit(event, { type: event, data });
  }

  /** 订阅事件 */
  on(event: AgentEventType, listener: (event: AgentEvent) => void): this {
    return super.on(event, listener);
  }
}
