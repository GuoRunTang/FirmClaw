/**
 * src/tools/registry.ts
 *
 * 工具注册中心。
 *
 * v1.0: 基础注册/查询/格式转换
 * v1.1: 新增 ajv 参数校验 + execute() 方法（校验→调用→返回）
 *
 * 核心改进：
 * - 注册工具时自动编译 JSON Schema（ajv）
 * - execute() 先校验参数，通过后才调用工具
 * - 校验失败不抛异常，返回 ToolResult { isError: true }，让 LLM 自我纠正
 */

import Ajv from 'ajv';
import type { Tool, ToolDefinition, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private validators: Map<string, Ajv.ValidateFunction> = new Map();
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
  }

  /** 注册一个工具（同时编译参数校验 schema） */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    // 编译 JSON Schema 校验器
    const validate = this.ajv.compile(tool.parameters);
    this.validators.set(tool.name, validate);
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
   * 校验工具参数
   *
   * @returns 校验错误信息，null 表示通过
   */
  validate(name: string, params: Record<string, unknown>): string | null {
    const validate = this.validators.get(name);
    if (!validate) {
      return `Unknown tool: "${name}"`;
    }
    const valid = validate(params);
    if (!valid) {
      const errors = validate.errors?.map(e =>
        `${e.instancePath || '(root)'} ${e.message}`
      ).join('; ');
      return `Parameter validation failed: ${errors}`;
    }
    return null;
  }

  /**
   * 执行工具（先校验参数，再调用）
   *
   * 这是 v1.1 的核心方法，AgentLoop 调用工具时走这个路径：
   *   validate → [失败则返回错误] → execute
   *
   * @param name    - 工具名称
   * @param params  - 工具参数（LLM 传过来的）
   * @param context - 工具执行上下文（workDir 等）
   * @returns 工具执行结果
   */
  async execute(name: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // 1. 参数校验
    const error = this.validate(name, params);
    if (error) {
      return { content: error, isError: true };
    }

    // 2. 查找工具
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: "${name}"`, isError: true };
    }

    // 3. 执行
    return tool.execute(params, context);
  }

  /**
   * 将所有工具转换为 OpenAI function calling 格式
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
    parameters: ToolDefinition;
  };
}
