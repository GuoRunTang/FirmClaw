/**
 * src/tools/registry.ts
 *
 * 【讲解】
 * ToolRegistry 是工具的"注册中心"。它的职责是：
 * 1. 管理所有可用工具的注册和查询
 * 2. 将工具列表转换为 OpenAI function calling 需要的格式
 *
 * 为什么需要 Registry？
 * - Agent Loop 不需要知道有哪些工具，只需要从 Registry 获取
 * - LLM 需要一个标准格式（OpenAI tools format）的工具列表
 * - 未来添加新工具只需 registry.register(newTool) 即可
 *
 * toOpenAITools() 方法是关键：
 * 它把我们的 Tool 接口转换为 OpenAI API 要求的格式：
 *   { type: 'function', function: { name, description, parameters } }
 * 这样 LLM 就能理解有哪些工具可用、每个工具需要什么参数。
 */

import type { Tool } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /** 注册一个工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** 按名称查找工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册的工具 */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 检查是否存在某个工具 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 将所有工具转换为 OpenAI function calling 格式
   * 这是 LLM API 需要的格式
   */
  toOpenAITools(): OpenAITool[] {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

/** OpenAI API 要求的工具格式 */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
