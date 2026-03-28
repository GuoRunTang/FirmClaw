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
 *
 * 解决方案：用事件发布/订阅模式。
 * - Agent Loop 通过 events.emit('xxx', data) 发布事件
 * - CLI 通过 events.on('xxx', callback) 订阅事件
 * - 两者完全解耦，Agent Loop 不需要知道谁在监听
 */

import { EventEmitter } from 'node:events';

/** 所有事件类型 */
export type AgentEventType =
  | 'thinking_delta'     // LLM 生成的文本片段
  | 'tool_start'         // 工具开始执行
  | 'tool_end'           // 工具执行完成
  | 'message_end'        // 最终文本回复完成
  | 'error'              // 出错了
  | 'session_start'      // v2.3: 会话开始 { id, title, createdAt }
  | 'context_trimmed';   // v2.3: 上下文被裁剪 { originalTokens, trimmedTokens }

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
