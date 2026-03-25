/**
 * src/agent/agent-loop.ts
 *
 * ReAct 循环的实现 —— 整个 FirmClaw 系统的心脏。
 *
 * v1.1 改进：
 * - 从 config.workDir 构建 ToolContext
 * - 调用 registry.execute(name, args, context) 替代 tool.execute(args)
 *   这样参数校验由 registry 自动完成
 */

import type { Message } from '../llm/client.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import { EventStream } from '../utils/event-stream.js';
import type { AgentConfig, AgentResult } from './types.js';

export class AgentLoop {
  private llm: LLMClient;
  private tools: ToolRegistry;
  private config: AgentConfig;
  private events: EventStream;

  constructor(llm: LLMClient, tools: ToolRegistry, config: AgentConfig) {
    this.llm = llm;
    this.tools = tools;
    this.config = config;
    this.events = new EventStream();
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
    // 初始化消息列表：系统提示词 + 用户消息
    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: userMessage },
    ];

    // 构建 ToolContext（所有工具调用共享）
    const toolContext = {
      workDir: this.config.workDir || process.cwd(),
    };

    let turns = 0;
    let totalToolCalls = 0;

    // ═══════════════════════════════════════════════════════
    // ReAct 循环开始
    // ═══════════════════════════════════════════════════════
    while (turns < this.config.maxTurns) {
      turns++;

      // ──── Step 1: 调用 LLM ────
      const response = await this.llm.chat(
        messages,
        this.tools,
        (delta) => {
          this.events.emit('thinking_delta', delta);
        },
      );

      // 将 LLM 回复加入消息历史
      messages.push(response);

      // ──── Step 2: 判断是否需要调工具 ────
      if (!response.tool_calls || response.tool_calls.length === 0) {
        this.events.emit('message_end', response.content);
        return { text: response.content, turns, toolCalls: totalToolCalls };
      }

      // ──── Step 3: 执行所有工具调用 ────
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown>;

        // 解析工具参数（JSON 字符串 → 对象）
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          this.events.emit('error', `Failed to parse tool arguments for "${toolName}"`);
          messages.push({
            role: 'tool',
            content: 'Error: Invalid JSON arguments',
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // 通知外部：工具开始执行
        this.events.emit('tool_start', { toolName, args: toolArgs });

        // 查找工具
        if (!this.tools.has(toolName)) {
          const errorMsg = `Unknown tool: "${toolName}". Available: ${this.tools.getAll().map(t => t.name).join(', ')}`;
          this.events.emit('error', errorMsg);
          messages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // 执行工具（通过 registry.execute，自动做参数校验）
        try {
          const result = await this.tools.execute(toolName, toolArgs, toolContext);
          totalToolCalls++;

          this.events.emit('tool_end', { toolName, result: result.content, isError: result.isError });

          messages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: toolCall.id,
          });
        } catch (error: unknown) {
          const errorMsg = `Tool "${toolName}" crashed: ${error instanceof Error ? error.message : String(error)}`;
          this.events.emit('error', errorMsg);
          messages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
        }
      }

      // ──── 继续循环：LLM 将看到工具结果，决定下一步 ────
    }

    // 超过最大轮次
    const warning = `[Reached max turns (${this.config.maxTurns})]`;
    this.events.emit('message_end', warning);
    return { text: warning, turns, toolCalls: totalToolCalls };
  }
}
