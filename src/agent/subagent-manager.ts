/**
 * src/agent/subagent-manager.ts
 *
 * 子智能体管理器 —— 创建、管理和销毁子智能体实例。
 *
 * 设计要点：
 * - 每个子智能体是独立的 AgentLoop 实例
 * - 共享 LLMClient（API 调用复用连接池）
 * - 可配置独立的 ToolRegistry（限制子智能体可用的工具）
 * - 子智能体执行结果通过 Promise 返回
 * - 通过 EventStream 转发子智能体的进度事件
 * - 支持 maxSubagents 并发限制
 * - 支持超时保护（防止子任务无限循环）
 *
 * v5.3: 初始实现
 */

import crypto from 'node:crypto';
import type { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig, AgentResult } from './types.js';
import type { EventStream } from '../utils/event-stream.js';
import { AgentLoop } from './agent-loop.js';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 子智能体配置 */
export interface SubagentConfig {
  /** 子任务描述（传给子智能体的 prompt） */
  task: string;
  /** 子智能体可用的工具列表（为空则继承全部） */
  allowedTools?: string[];
  /** 最大循环轮次（默认 5，子任务通常较短） */
  maxTurns?: number;
  /** 是否共享父智能体的会话上下文 */
  inheritSession?: boolean;
  /** 子智能体执行超时（毫秒，默认 120000 = 2 分钟） */
  timeoutMs?: number;
}

/** 子智能体执行结果 */
export interface SubagentResult {
  /** 子智能体唯一 ID */
  subagentId: string;
  /** 任务描述 */
  task: string;
  /** LLM 最终回复 */
  text: string;
  /** 循环轮次 */
  turns: number;
  /** 工具调用次数 */
  toolCalls: number;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 错误信息（如果执行失败） */
  error?: string;
}

/** SubagentManager 配置 */
export interface SubagentManagerConfig {
  /** 最大并行子智能体数量（默认 3） */
  maxSubagents?: number;
  /** 默认超时时间（毫秒，默认 120000） */
  defaultTimeoutMs?: number;
  /** 默认最大轮次（默认 5） */
  defaultMaxTurns?: number;
}

// ═══════════════════════════════════════════════════════════════
// 实现
// ═══════════════════════════════════════════════════════════════

export class SubagentManager {
  private parentLlm: LLMClient;
  private parentTools: ToolRegistry;
  private parentConfig: AgentConfig;
  private maxSubagents: number;
  private defaultTimeoutMs: number;
  private defaultMaxTurns: number;
  private activeCount: number = 0;
  private eventStream?: EventStream;

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    config: AgentConfig,
    subConfig?: SubagentManagerConfig,
    eventStream?: EventStream,
  ) {
    this.parentLlm = llm;
    this.parentTools = tools;
    this.parentConfig = config;
    this.maxSubagents = subConfig?.maxSubagents ?? 3;
    this.defaultTimeoutMs = subConfig?.defaultTimeoutMs ?? 120_000;
    this.defaultMaxTurns = subConfig?.defaultMaxTurns ?? 5;
    this.eventStream = eventStream;
  }

  /**
   * 创建并执行一个子智能体
   *
   * @param config - 子智能体配置
   * @returns 子智能体执行结果
   * @throws 超出最大并发数时抛出 Error
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    if (this.activeCount >= this.maxSubagents) {
      throw new Error(`Maximum subagents reached (${this.maxSubagents}). Wait for running tasks to complete.`);
    }

    const subagentId = `sub_${crypto.randomUUID().slice(0, 8)}`;
    const maxTurns = config.maxTurns ?? this.defaultMaxTurns;
    const timeoutMs = config.timeoutMs ?? this.defaultTimeoutMs;
    const startTime = Date.now();

    // 创建子智能体专用的 ToolRegistry
    const tools = this.createSubagentTools(config.allowedTools);

    // 创建子智能体专用的 AgentLoop
    const loop = this.createSubagentLoop(tools, config, maxTurns);

    this.activeCount++;

    try {
      // 带超时的执行
      const result = await this.runWithTimeout(loop, config.task, timeoutMs);
      const durationMs = Date.now() - startTime;

      return {
        subagentId,
        task: config.task,
        text: result.text,
        turns: result.turns,
        toolCalls: result.toolCalls,
        durationMs,
        timedOut: false,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      // 清理子智能体的事件监听
      loop.getEvents().removeAllListeners();

      return {
        subagentId,
        task: config.task,
        text: '',
        turns: 0,
        toolCalls: 0,
        durationMs,
        timedOut: message.includes('timeout') || message.includes('Timeout'),
        error: message,
      };
    } finally {
      this.activeCount--;
    }
  }

  /**
   * 获取当前活跃的子智能体数量
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * 获取最大并发数量
   */
  getMaxSubagents(): number {
    return this.maxSubagents;
  }

  /**
   * 创建子智能体专用的 ToolRegistry
   *
   * 如果指定了 allowedTools，只注册这些工具；
   * 否则继承父智能体的全部工具。
   */
  private createSubagentTools(allowedTools?: string[]): ToolRegistry {
    if (!allowedTools || allowedTools.length === 0) {
      // 继承父工具的完整副本
      return this.parentTools;
    }

    // 只注册指定的工具（需要从父 registry 获取）
    // 返回一个受限的 registry
    const tools = new ToolRegistry();

    // 尝试从父 registry 获取工具定义
    for (const toolName of allowedTools) {
      const tool = this.parentTools.get(toolName);
      if (tool) {
        tools.register(tool);
      }
    }

    return tools;
  }

  /**
   * 创建子智能体专用的 AgentLoop
   */
  private createSubagentLoop(
    tools: ToolRegistry,
    config: SubagentConfig,
    maxTurns: number,
  ): AgentLoop {
    return new AgentLoop(this.parentLlm, tools, {
      systemPrompt: this.parentConfig.systemPrompt,
      maxTurns,
      workDir: this.parentConfig.workDir ?? process.cwd(),
      sessionManager: config.inheritSession
        ? this.parentConfig.sessionManager
        : undefined,
      contextBuilder: this.parentConfig.contextBuilder,
      tokenCounter: this.parentConfig.tokenCounter,
      trimConfig: this.parentConfig.trimConfig,
      summarizer: this.parentConfig.summarizer,
    });
  }

  /**
   * 带超时执行子智能体
   */
  private async runWithTimeout(
    loop: AgentLoop,
    task: string,
    timeoutMs: number,
  ): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Subagent timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      loop.run(task)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
