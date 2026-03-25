/**
 * src/agent/agent-loop.ts
 *
 * 【讲解】
 * 这是整个 FirmClaw 系统的心脏 —— ReAct 循环的实现。
 *
 * ═══════════════════════════════════════════════════════════════
 * 核心算法（伪代码）：
 * ═══════════════════════════════════════════════════════════════
 *
 * messages = [system_prompt, user_message]
 *
 * while turns < maxTurns:
 *     response = LLM(messages, tools)        ← 调用 LLM
 *     messages.push(response)                 ← 记录 LLM 回复
 *
 *     if response 没有 tool_calls:
 *         return response.content             ← 纯文本 → 结束
 *
 *     for each tool_call in response.tool_calls:
 *         result = execute_tool(tool_call)     ← 执行工具
 *         messages.push(result)               ← 把结果反馈给 LLM
 *
 * # 循环回到顶部，LLM 看到工具结果后继续思考
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * 用人话说就是：
 * 1. 把用户的消息发给 LLM
 * 2. LLM 要么直接回答，要么要求调工具
 * 3. 如果要调工具 → 执行工具 → 把结果告诉 LLM → 回到第1步
 * 4. 如果直接回答 → 输出给用户 → 结束
 *
 * 这就是 ReAct = Reasoning（LLM 推理）+ Acting（工具执行）
 *
 * 关键设计：
 * - maxTurns 限制：防止 LLM 陷入无限循环（比如反复调同一个工具）
 * - 错误不中断：工具执行失败时返回错误信息给 LLM，让它调整策略
 * - 事件广播：通过 EventStream 实时通知外部发生了什么
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
        // 流式回调：实时输出 LLM 正在生成的内容
        (delta) => {
          this.events.emit('thinking_delta', delta);
        },
      );

      // 将 LLM 回复加入消息历史
      messages.push(response);

      // ──── Step 2: 判断是否需要调工具 ────
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // 没有工具调用 → LLM 给出了最终答案 → 循环结束
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
        const tool = this.tools.get(toolName);
        if (!tool) {
          const errorMsg = `Unknown tool: "${toolName}". Available: ${this.tools.getAll().map(t => t.name).join(', ')}`;
          this.events.emit('error', errorMsg);
          messages.push({
            role: 'tool',
            content: errorMsg,
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // 执行工具
        try {
          const result = await tool.execute(toolArgs);
          totalToolCalls++;

          // 通知外部：工具执行完成
          this.events.emit('tool_end', { toolName, result: result.content, isError: result.isError });

          // 将工具结果加入消息历史（作为 observation 反馈给 LLM）
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
