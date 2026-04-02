/**
 * src/session/summarizer.ts
 *
 * LLM 摘要压缩器 —— 将旧消息压缩为高质量摘要。
 *
 * 压缩策略：
 * 1. 当历史消息的 token 数超过 summarizeThreshold 时触发
 * 2. 取最早的 N 条消息（保留摘要行如果有的话），调用 LLM 生成摘要
 * 3. 用一条 system 摘要消息替代被压缩的原始消息
 * 4. 摘要 prompt 明确要求保留关键决策、用户偏好、技术方案
 *
 * 滑动窗口：
 * - 每次摘要后，摘要成为新的"锚点"
 * - 后续继续基于 摘要 + 新消息 进行下一轮摘要
 *
 * 执行优先级（在 AgentLoop 中）：
 * 1. LLM 摘要压缩（保留语义，高质量）
 * 2. TokenCounter 简单裁剪（保底措施，防止摘要后仍超限）
 *
 * v3.1: 初始实现
 */

import type { Message } from '../llm/client.js';
import type { LLMClient } from '../llm/client.js';
import type { TokenCounter } from '../utils/token-counter.js';

/** 摘要器配置 */
export interface SummarizerConfig {
  /** 触发摘要的历史 token 阈值（默认 80000） */
  summarizeThreshold?: number;
  /** 每次摘要的消息条数上限（默认 50） */
  maxMessagesToSummarize?: number;
  /** 摘要的最大 token 数（默认 2000） */
  maxSummaryTokens?: number;
  /** 是否在控制台输出摘要统计 */
  verbose?: boolean;
}

/** 摘要结果 */
export interface SummaryResult {
  /** 压缩后的消息列表（摘要 + 未压缩的消息） */
  messages: Message[];
  /** 是否执行了摘要 */
  summarized: boolean;
  /** 被压缩的消息条数 */
  compressedCount: number;
  /** 摘要前的 token 数 */
  originalTokens: number;
  /** 摘要后的 token 数 */
  newTokens: number;
}

/** 内置摘要 prompt */
const SUMMARY_PROMPT = `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要。

要求：
1. 保留所有关键决策和结论（用 ✓ 标记）
2. 保留用户明确表达的偏好和要求
3. 保留重要的技术方案和实现细节
4. 保留未完成的任务或待办事项（用 ○ 标记）
5. 使用简洁的条目化格式
6. 不超过 1500 字

对话历史：
{{messages}}

请输出摘要：`;

export class Summarizer {
  private llm: LLMClient;
  private tokenCounter: TokenCounter;
  private config: Required<SummarizerConfig>;

  constructor(
    llm: LLMClient,
    tokenCounter: TokenCounter,
    config?: SummarizerConfig,
  ) {
    this.llm = llm;
    this.tokenCounter = tokenCounter;
    this.config = {
      summarizeThreshold: config?.summarizeThreshold ?? 80000,
      maxMessagesToSummarize: config?.maxMessagesToSummarize ?? 50,
      maxSummaryTokens: config?.maxSummaryTokens ?? 2000,
      verbose: config?.verbose ?? false,
    };
  }

  /** v7.1: 获取当前配置（供 settings.get 使用） */
  getConfig(): Required<SummarizerConfig> {
    return { ...this.config };
  }

  /** v7.1: 动态更新配置（供 settings.update 使用） */
  updateConfig(config: Partial<SummarizerConfig>): void {
    if (config.summarizeThreshold !== undefined) this.config.summarizeThreshold = config.summarizeThreshold;
    if (config.maxMessagesToSummarize !== undefined) this.config.maxMessagesToSummarize = config.maxMessagesToSummarize;
    if (config.maxSummaryTokens !== undefined) this.config.maxSummaryTokens = config.maxSummaryTokens;
    if (config.verbose !== undefined) this.config.verbose = config.verbose;
  }

  /**
   * 判断是否需要摘要
   *
   * @param messages - 完整消息列表（不含当前 system prompt）
   * @returns 是否超过阈值
   */
  shouldSummarize(messages: Message[]): boolean {
    if (messages.length === 0) return false;
    const tokens = this.tokenCounter.countMessages(messages);
    return tokens >= this.config.summarizeThreshold;
  }

  /**
   * 执行摘要压缩
   *
   * 流程：
   * 1. 找到最早的可压缩消息段
   * 2. 调用 LLM 生成摘要
   * 3. 用摘要消息替代原始消息段
   *
   * @param messages - 完整消息列表
   * @returns 压缩后的消息列表 + 统计信息
   */
  async summarize(messages: Message[]): Promise<SummaryResult> {
    const originalTokens = this.tokenCounter.countMessages(messages);

    // 不需要摘要 —— 直接返回
    if (!this.shouldSummarize(messages)) {
      return {
        messages,
        summarized: false,
        compressedCount: 0,
        originalTokens,
        newTokens: originalTokens,
      };
    }

    // 确定需要压缩的消息段
    // 跳过已有的摘要消息（system 角色且包含"[摘要]"标记）
    let summaryAnchor = -1;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'system' && messages[i].content.includes('[摘要]')) {
        summaryAnchor = i;
      } else {
        break;
      }
    }

    // 从摘要锚点之后开始，取最多 N 条消息进行压缩
    const startIdx = summaryAnchor + 1;
    const endIdx = Math.min(startIdx + this.config.maxMessagesToSummarize, messages.length);

    // 如果除了摘要之外没有更多消息，不需要再次压缩
    if (startIdx >= messages.length) {
      return {
        messages,
        summarized: false,
        compressedCount: 0,
        originalTokens,
        newTokens: originalTokens,
      };
    }

    // 留出至少一条最新消息不被压缩
    const effectiveEndIdx = Math.max(endIdx, messages.length - 1);
    const messagesToCompress = messages.slice(startIdx, effectiveEndIdx);

    if (messagesToCompress.length === 0) {
      return {
        messages,
        summarized: false,
        compressedCount: 0,
        originalTokens,
        newTokens: originalTokens,
      };
    }

    // 构建摘要请求
    const summaryRequest = this.buildSummaryRequest(messagesToCompress);

    // 调用 LLM 生成摘要
    let summaryText: string;
    try {
      const response = await this.llm.chat(summaryRequest, {
        getAll: () => [],
        register: () => {},
        has: () => false,
        execute: async () => ({ content: '', isError: true }),
      } as unknown as import('../tools/registry.js').ToolRegistry);
      summaryText = response.content;
    } catch (error: unknown) {
      // 摘要失败不阻塞主流程，返回原始消息
      if (this.config.verbose) {
        console.error('[Summarizer] 摘要生成失败:', error instanceof Error ? error.message : String(error));
      }
      return {
        messages,
        summarized: false,
        compressedCount: 0,
        originalTokens,
        newTokens: originalTokens,
      };
    }

    // 构建摘要消息
    const summaryMessage: Message = {
      role: 'system',
      content: `[摘要] 以下是对之前对话历史的压缩摘要（${messagesToCompress.length} 条消息压缩为摘要）：\n\n${summaryText}`,
    };

    // 组装新消息列表：摘要 + 未压缩的消息
    const remaining = messages.slice(effectiveEndIdx);
    const newMessages: Message[] = [];

    if (summaryAnchor >= 0) {
      // 保留已有的摘要
      newMessages.push(...messages.slice(0, summaryAnchor + 1));
    }
    newMessages.push(summaryMessage);
    newMessages.push(...remaining);

    const newTokens = this.tokenCounter.countMessages(newMessages);

    if (this.config.verbose) {
      console.log(`[Summarizer] ${messagesToCompress.length} messages compressed, ${originalTokens} → ${newTokens} tokens`);
    }

    return {
      messages: newMessages,
      summarized: true,
      compressedCount: messagesToCompress.length,
      originalTokens,
      newTokens,
    };
  }

  /**
   * 构建摘要请求（供 LLM 调用）
   *
   * @param messagesToCompress - 需要压缩的消息段
   * @returns 发送给 LLM 的 messages 数组
   */
  private buildSummaryRequest(messagesToCompress: Message[]): Message[] {
    // 将消息格式化为可读文本
    const formattedMessages = messagesToCompress
      .map(msg => {
        const roleLabel = {
          system: '[系统]',
          user: '[用户]',
          assistant: '[助手]',
          tool: '[工具结果]',
        }[msg.role] || '[未知]';
        return `${roleLabel}: ${msg.content}`;
      })
      .join('\n\n');

    const promptContent = SUMMARY_PROMPT.replace('{{messages}}', formattedMessages);

    return [
      { role: 'system', content: '你是一个对话摘要助手。请严格按照用户要求的格式输出摘要。' },
      { role: 'user', content: promptContent },
    ];
  }
}
