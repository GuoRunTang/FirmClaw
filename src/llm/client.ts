/**
 * src/llm/client.ts
 *
 * 【讲解】
 * LLMClient 是与 LLM API 通信的封装层。
 *
 * 当前默认适配：MiniMax M2.7 API（OpenAI 兼容格式）
 *   baseURL = https://api.minimax.chat/v1
 *   认证方式 = Authorization: Bearer eyJ...
 *   SDK = openai (官方 OpenAI SDK)
 *
 * 使用 OpenAI 兼容格式的好处：
 * - 国内外大部分 LLM 提供商都支持（MiniMax、DeepSeek、Kimi、智谱等）
 * - 只需改 baseURL 和 API Key 就能切换模型
 * - function calling 格式统一，工具调用解析逻辑一致
 *
 * MiniMax M2.7 的特性：
 * - 支持 function calling（工具调用）
 * - 兼容 OpenAI Chat Completions API
 * - 环境变量支持 LLM_* 和 ANTHROPIC_* 两套命名
 *
 * 本文件的核心价值：
 * - 对外暴露统一的 Message 接口
 * - Agent Loop 不需要知道底层用的是哪个模型提供商
 * - 切换模型只需改配置，不需要改代码
 */

import OpenAI from 'openai';
import type { ToolRegistry } from '../tools/registry.js';

// ═══════════════════════════════════════════════════════════════════
// Message 类型 —— FirmClaw 内部的统一消息格式
// ═══════════════════════════════════════════════════════════════════

/**
 * 工具调用信息
 *
 * 这个结构完全对标 OpenAI 的 tool_calls 格式：
 * - id: 工具调用的唯一标识（用于把结果对应回请求）
 * - type: 固定为 'function'（OpenAI 约定）
 * - function.name: 要调用的工具名称
 * - function.arguments: JSON 字符串形式的参数
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

/**
 * 对话消息（FirmClaw 内部格式）
 *
 * role 的四种值：
 * - system: 系统提示词（定义智能体行为）
 * - user: 用户输入
 * - assistant: LLM 回复（可能包含 tool_calls）
 * - tool: 工具执行结果（通过 tool_call_id 关联到对应的工具调用）
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

// ═══════════════════════════════════════════════════════════════════
// LLM Client
// ═══════════════════════════════════════════════════════════════════

export class LLMClient {
  private client: OpenAI;
  private model: string;

  /**
   * 构造函数
   *
   * @param apiKey   - API 密钥
   * @param baseURL  - API 基础 URL（如 https://api.minimax.chat/v1）
   * @param model    - 模型名称（如 MiniMax-M2.7）
   */
  constructor(apiKey: string, baseURL: string, model: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    this.model = model;
  }

  /**
   * 将工具注册表转换为 OpenAI API 的 tools 格式
   *
   * 转换示例：
   *   内部格式: { name: 'bash', description: '...', parameters: { type: 'object', ... } }
   *   OpenAI:   { type: 'function', function: { name: 'bash', description: '...', parameters: { ... } } }
   *
   * 为什么需要这层转换？
   * - OpenAI 要求每个工具定义被包裹在 { type: 'function', function: {...} } 里
   * - 我们的内部格式更简洁，不需要这层嵌套
   */
  private convertTools(tools: ToolRegistry): OpenAI.ChatCompletionTool[] {
    return tools.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * 发送消息给 LLM，获取回复
   *
   * 这是最核心的方法，Agent Loop 的每一步都通过它与 LLM 通信。
   *
   * @param messages - 完整的对话历史（包括 system、user、assistant、tool 消息）
   * @param tools    - 工具注册表（LLM 需要知道有哪些工具可用）
   * @param onDelta  - 可选的流式回调（实时输出 LLM 正在生成的内容）
   * @returns LLM 的回复（可能是纯文本，也可能包含 tool_calls）
   */
  async chat(
    messages: Message[],
    tools: ToolRegistry,
    onDelta?: (text: string) => void,
  ): Promise<Message> {
    const openaiTools = this.convertTools(tools);
    const hasTools = openaiTools.length > 0;

    // ──── 构建请求参数 ────
    const params: OpenAI.ChatCompletionCreateParams = {
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(hasTools ? { tools: openaiTools } : {}),
    };

    // ──── 分支 A：非流式请求（用于测试等场景）────
    if (!onDelta) {
      const response = await this.client.chat.completions.create(params);
      return this.parseResponse(response);
    }

    // ──── 分支 B：流式请求（用于 CLI 交互）────
    const stream = await this.client.chat.completions.create({
      ...params,
      stream: true,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    // 逐块读取流式响应
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // 文本内容：直接输出
      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }

      // 工具调用：逐步累积
      // OpenAI 的流式工具调用会分多次发送：
      //   第一次：{ id: 'xxx', type: 'function', function: { name: 'bash', arguments: '' } }
      //   后续：  { function: { arguments: '{"co' } }
      //   最后：  { function: { arguments: 'mmand":"ls"}' } }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          // 确保 toolCalls 数组有足够长度
          while (toolCalls.length <= idx) {
            toolCalls.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.type) toolCalls[idx].type = tc.type as 'function';
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }

    // 过滤掉空的 tool_calls（只有 id 但没有 name 的无效条目）
    const validToolCalls = toolCalls.filter(tc => tc.id && tc.function.name);

    return {
      role: 'assistant',
      content,
      tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
    };
  }

  /**
   * 解析 OpenAI API 的非流式响应为内部 Message 格式
   *
   * OpenAI 的响应结构：
   * {
   *   choices: [{
   *     message: {
   *       role: 'assistant',
   *       content: '...',
   *       tool_calls: [{ id, type, function: { name, arguments } }]
   *     }
   *   }]
   * }
   */
  private parseResponse(response: OpenAI.ChatCompletion): Message {
    const choice = response.choices[0];
    const message = choice?.message;

    return {
      role: 'assistant',
      content: message?.content || '',
      tool_calls: message?.tool_calls as ToolCall[] | undefined,
    };
  }
}
