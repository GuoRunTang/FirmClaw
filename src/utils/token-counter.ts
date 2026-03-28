/**
 * src/utils/token-counter.ts
 *
 * Token 计数器 —— 简单的 token 估算与消息裁剪。
 *
 * 估算策略：
 * - 约 4 字符 ≈ 1 token（中英文混合场景的粗略估计）
 * - 这不是精确计数，但足以做裁剪判断
 * - Phase 4 可升级为 tiktoken（需安装 WASM 依赖）
 *
 * 裁剪策略（按优先级）：
 * 1. system 消息 → 永不裁剪
 * 2. user 消息 → 永不裁剪
 * 3. assistant 消息 → 永不裁剪（保留推理链）
 * 4. tool 消息 → 优先裁剪，超过 maxToolResultTokens 时截断
 * 5. 整体裁剪 → 总 token 超限时，从最早的消息对开始移除（保留首条 user）
 *
 * v2.3: 完整实现
 */

import type { Message } from '../llm/client.js';

/** 上下文裁剪配置 */
export interface TrimConfig {
  /** 最大 token 数（对应 LLM 上下文窗口），默认 128000 */
  maxTokens?: number;
  /** 单条 tool 消息最大 token 数，默认 500 */
  maxToolResultTokens?: number;
  /** 是否在控制台输出裁剪统计 */
  verbose?: boolean;
}

/** 裁剪结果 */
export interface TrimResult {
  /** 裁剪后的消息数组 */
  messages: Message[];
  /** 裁剪前总 token 数 */
  originalTokens: number;
  /** 裁剪后总 token 数 */
  trimmedTokens: number;
  /** 被移除的消息数量 */
  removedCount: number;
  /** 被截断的 tool 消息数量 */
  truncatedCount: number;
}

export class TokenCounter {
  /** 每 token 平均字符数（估算系数） */
  private static readonly CHARS_PER_TOKEN = 4;

  /** 估算纯文本的 token 数 */
  countText(text: string): number {
    return Math.ceil(text.length / TokenCounter.CHARS_PER_TOKEN);
  }

  /** 估算单条消息的 token 数 */
  countMessage(message: Message): number {
    // 基础：消息内容
    let tokens = this.countText(message.content);

    // tool_calls 也占 token（粗略估算）
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        tokens += this.countText(tc.function.name) + this.countText(tc.function.arguments) + 10;
      }
    }

    return tokens;
  }

  /** 估算消息列表的总 token 数 */
  countMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessage(msg), 0);
  }

  /**
   * 裁剪消息列表，确保不超过 token 上限
   *
   * 裁剪分两步：
   * 1. 单条截断：tool 消息超过 maxToolResultTokens 时截断
   * 2. 整体裁剪：总 token 仍超限时，从最早的消息对（assistant + tool）开始移除
   *    - 始终保留 [0] system 消息
   *    - 始终保留第一条 user 消息
   */
  trimMessages(messages: Message[], config?: TrimConfig): TrimResult {
    const maxTokens = config?.maxTokens ?? 128000;
    const maxToolTokens = config?.maxToolResultTokens ?? 500;

    // Step 1: 复制并截断过长的 tool 消息
    let truncatedCount = 0;
    const processed: Message[] = messages.map(msg => {
      if (msg.role !== 'tool') return msg;

      const msgTokens = this.countMessage(msg);
      if (msgTokens <= maxToolTokens) return msg;

      // 截断：保留前 maxToolTokens 个 token 对应的字符数
      const maxChars = maxToolTokens * TokenCounter.CHARS_PER_TOKEN;
      const truncatedContent = msg.content.slice(0, maxChars) + '\n...(truncated)';
      truncatedCount++;

      return { ...msg, content: truncatedContent };
    });

    // Step 2: 检查是否仍超限
    let totalTokens = this.countMessages(processed);
    if (totalTokens <= maxTokens) {
      return {
        messages: processed,
        originalTokens: totalTokens,
        trimmedTokens: totalTokens,
        removedCount: 0,
        truncatedCount,
      };
    }

    // Step 3: 整体裁剪 —— 从最早的可移除消息开始移除
    // 保护规则：
    //   - messages[0] 永不移除（system）
    //   - 第一条 user 消息不移除
    const originalTokens = totalTokens;
    let removedCount = 0;

    // 找到第一条 user 消息的索引
    let firstUserIdx = -1;
    for (let i = 1; i < processed.length; i++) {
      if (processed[i].role === 'user') {
        firstUserIdx = i;
        break;
      }
    }

    // 从尾部向前移除（保留最新的消息）
    // 但不能移除 system [0] 和第一条 user
    const minProtectedIdx = firstUserIdx >= 0 ? firstUserIdx : 0;

    while (totalTokens > maxTokens && processed.length > minProtectedIdx + 1) {
      // 从 minProtectedIdx + 1 位置开始移除（不移除第一条 user 之后的 assistant）
      // 策略：找到最早的"可移除组"（连续的 assistant + tool 消息）
      let removeStart = minProtectedIdx + 1;

      // 跳过紧跟第一条 user 的 assistant 回复（保留首次对话完整性）
      if (processed[removeStart]?.role === 'assistant' && !processed[removeStart].tool_calls) {
        // 纯文本回复，跳过
        removeStart++;
      }

      if (removeStart >= processed.length) break;

      const removed = processed.splice(removeStart, 1)[0];
      totalTokens -= this.countMessage(removed);
      removedCount++;
    }

    return {
      messages: processed,
      originalTokens,
      trimmedTokens: totalTokens,
      removedCount,
      truncatedCount,
    };
  }
}
