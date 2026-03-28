/**
 * src/utils/token-counter.ts
 *
 * Token 计数器 —— 简单的 token 估算与消息裁剪。
 *
 * 占位实现 —— v2.3 会完善。
 * 当前仅提供兼容接口，确保 v2.1 的 agent/types.ts 可以编译。
 */

import type { Message } from '../llm/client.js';

/** 上下文裁剪配置（v2.3 完整定义） */
export interface TrimConfig {
  /** 最大 token 数（对应 LLM 上下文窗口），默认 128000 */
  maxTokens?: number;
  /** 单条 tool 消息最大 token 数，默认 500 */
  maxToolResultTokens?: number;
  /** 是否在控制台输出裁剪统计 */
  verbose?: boolean;
}

export class TokenCounter {
  /** 估算纯文本的 token 数（每 4 字符 ≈ 1 token） */
  countText(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** 估算单条消息的 token 数 */
  countMessage(message: Message): number {
    return this.countText(message.content);
  }

  /** 估算消息列表的总 token 数 */
  countMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessage(msg), 0);
  }

  /**
   * 裁剪消息列表（v2.3 完整实现）
   * 当前直接返回原数组，不做任何裁剪。
   */
  trimMessages(messages: Message[], _config?: TrimConfig): {
    messages: Message[];
    originalTokens: number;
    trimmedTokens: number;
    removedCount: number;
    truncatedCount: number;
  } {
    const tokens = this.countMessages(messages);
    return {
      messages,
      originalTokens: tokens,
      trimmedTokens: tokens,
      removedCount: 0,
      truncatedCount: 0,
    };
  }
}
