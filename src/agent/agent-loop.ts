/**
 * src/agent/agent-loop.ts
 *
 * ReAct 循环的实现 —— 整个 FirmClaw 系统的心脏。
 *
 * v1.0: 初始实现（基础 ReAct 循环）
 * v1.1: 从 config.workDir 构建 ToolContext，registry.execute 校验
 * v2.3: 集成 SessionManager + ContextBuilder + TokenCounter
 *        - 支持多轮对话（会话持久化）
 *        - 动态系统提示词（SOUL.md / AGENTS.md / MEMORY.md）
 *        - 上下文窗口管理（token 裁剪）
 *        - 渐进增强：sessionManager/contextBuilder/tokenCounter 为可选
 */

import type { Message } from '../llm/client.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolContext } from '../tools/context.js';
import { EventStream } from '../utils/event-stream.js';
import type { AgentConfig, AgentResult } from './types.js';
import type { SessionManager } from '../session/manager.js';
import type { ContextBuilder } from '../session/context-builder.js';
import type { TokenCounter } from '../utils/token-counter.js';

export class AgentLoop {
  private llm: LLMClient;
  private tools: ToolRegistry;
  private config: AgentConfig;
  private events: EventStream;

  // Phase 3 可选组件
  private sessionManager?: SessionManager;
  private contextBuilder?: ContextBuilder;
  private tokenCounter?: TokenCounter;

  constructor(llm: LLMClient, tools: ToolRegistry, config: AgentConfig) {
    this.llm = llm;
    this.tools = tools;
    this.config = config;
    this.events = new EventStream();

    // Phase 3: 可选组件
    this.sessionManager = config.sessionManager;
    this.contextBuilder = config.contextBuilder;
    this.tokenCounter = config.tokenCounter;
  }

  /** 获取事件流（供 CLI 等外部模块订阅） */
  getEvents(): EventStream {
    return this.events;
  }

  /**
   * 运行一次完整的 Agent 循环
   *
   * @param userMessage - 用户的输入文本
   * @returns 最终文本结果 + 统计信息
   */
  async run(userMessage: string): Promise<AgentResult> {
    // ═══════════════════════════════════════════════════════
    // Phase 3: 会话管理
    // ═══════════════════════════════════════════════════════

    // 如果没有会话且启用了 sessionManager，自动创建
    if (this.sessionManager && this.sessionManager.isEnabled() && !this.sessionManager.getCurrentSessionId()) {
      const workDir = this.config.workDir || process.cwd();
      const meta = await this.sessionManager.create(workDir, userMessage);
      this.events.emit('session_start', { id: meta.id, title: meta.title, createdAt: meta.createdAt });
    }

    // ═══════════════════════════════════════════════════════
    // 构建系统提示词
    // ═══════════════════════════════════════════════════════

    let systemPrompt: string;
    if (this.contextBuilder && this.sessionManager) {
      const sessionMeta = this.sessionManager.getCurrentMeta() ?? undefined;
      systemPrompt = await this.contextBuilder.build(this.tools, sessionMeta);
    } else {
      systemPrompt = this.config.systemPrompt;
    }

    // ═══════════════════════════════════════════════════════
    // 恢复历史消息
    // ═══════════════════════════════════════════════════════

    const historyMessages = this.sessionManager
      ? await this.sessionManager.getMessages()
      : [];

    // 构建完整的消息列表
    const allMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    // 构建 ToolContext（所有工具调用共享）
    const toolContext: ToolContext = {
      workDir: this.config.workDir || process.cwd(),
      sessionId: this.sessionManager?.getCurrentSessionId() ?? undefined,
    };

    let turns = 0;
    let totalToolCalls = 0;

    // 记录本轮需要保存的所有消息
    const roundMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }> = [];

    // ═══════════════════════════════════════════════════════
    // ReAct 循环开始
    // ═══════════════════════════════════════════════════════
    while (turns < this.config.maxTurns) {
      turns++;

      // ──── Phase 3: 上下文裁剪 ────
      if (this.tokenCounter) {
        const result = this.tokenCounter.trimMessages(allMessages, this.config.trimConfig);
        if (result.trimmedTokens < result.originalTokens) {
          allMessages.length = 0;
          allMessages.push(...result.messages);
          this.events.emit('context_trimmed', {
            originalTokens: result.originalTokens,
            trimmedTokens: result.trimmedTokens,
            removedCount: result.removedCount,
            truncatedCount: result.truncatedCount,
          });
        }
      }

      // ──── Step 1: 调用 LLM ────
      const response = await this.llm.chat(
        allMessages,
        this.tools,
        (delta) => {
          this.events.emit('thinking_delta', delta);
        },
      );

      // 将 LLM 回复加入消息历史
      allMessages.push(response);

      // ──── Step 2: 判断是否需要调工具 ────
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // 保存本轮消息到会话
        await this.persistRound(userMessage, allMessages, roundMessages);

        this.events.emit('message_end', response.content);
        return { text: response.content, turns, toolCalls: totalToolCalls };
      }

      // 记录 assistant 回复（用于会话持久化）
      roundMessages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // ──── Step 3: 执行所有工具调用 ────
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown>;

        // 解析工具参数（JSON 字符串 → 对象）
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          this.events.emit('error', `Failed to parse tool arguments for "${toolName}"`);
          const errorMsg = 'Error: Invalid JSON arguments';
          allMessages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
          roundMessages.push({ role: 'tool', content: errorMsg, tool_call_id: toolCall.id });
          continue;
        }

        // 通知外部：工具开始执行
        this.events.emit('tool_start', { toolName, args: toolArgs });

        // 查找工具
        if (!this.tools.has(toolName)) {
          const errorMsg = `Unknown tool: "${toolName}". Available: ${this.tools.getAll().map(t => t.name).join(', ')}`;
          this.events.emit('error', errorMsg);
          allMessages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
          roundMessages.push({ role: 'tool', content: errorMsg, tool_call_id: toolCall.id });
          continue;
        }

        // 执行工具（通过 registry.execute，自动做参数校验）
        try {
          const result = await this.tools.execute(toolName, toolArgs, toolContext);
          totalToolCalls++;

          this.events.emit('tool_end', { toolName, result: result.content, isError: result.isError });

          const toolMsg = {
            role: 'tool' as const,
            content: result.content,
            tool_call_id: toolCall.id,
          };
          allMessages.push(toolMsg);
          roundMessages.push(toolMsg);
        } catch (error: unknown) {
          const errorMsg = `Tool "${toolName}" crashed: ${error instanceof Error ? error.message : String(error)}`;
          this.events.emit('error', errorMsg);
          allMessages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
          roundMessages.push({ role: 'tool', content: errorMsg, tool_call_id: toolCall.id });
        }
      }

      // ──── 继续循环：LLM 将看到工具结果，决定下一步 ────
    }

    // 超过最大轮次
    const warning = `[Reached max turns (${this.config.maxTurns})]`;
    await this.persistRound(userMessage, allMessages, roundMessages);
    this.events.emit('message_end', warning);
    return { text: warning, turns, toolCalls: totalToolCalls };
  }

  /**
   * 保存本轮对话消息到会话存储
   *
   * 保存顺序：user 消息 + assistant 回复 + 所有 tool 结果
   */
  private async persistRound(
    userMessage: string,
    _allMessages: Message[],
    roundMessages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>,
  ): Promise<void> {
    if (!this.sessionManager || !this.sessionManager.getCurrentSessionId()) return;

    const now = new Date().toISOString();
    const storedMessages = [
      { role: 'user' as const, content: userMessage, timestamp: now },
      ...roundMessages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        timestamp: now,
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      })),
    ];

    await this.sessionManager.append(storedMessages);
  }

  /**
   * 切换到指定会话（下次 run 时使用新会话的历史）
   */
  resetSession(sessionId: string): void {
    if (this.sessionManager) {
      this.sessionManager.switchSession(sessionId);
    }
  }

  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null {
    return this.sessionManager?.getCurrentSessionId() ?? null;
  }

  /** 获取会话管理器引用（供 CLI 使用） */
  getSessionManager(): SessionManager | null {
    return this.sessionManager ?? null;
  }
}
