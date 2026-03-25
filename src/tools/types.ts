/**
 * src/tools/types.ts
 *
 * 【讲解】
 * 这是工具系统的"契约文件"——定义了所有工具必须遵守的接口规范。
 *
 * 核心概念：
 * - ToolDefinition：工具参数的 JSON Schema 描述，告诉 LLM 这个工具接受什么参数
 * - Tool：工具的完整定义，包含名称、描述、参数规范、执行函数
 * - ToolResult：工具执行后的返回值，包含输出内容和错误标志
 *
 * 为什么需要这个文件？
 * 1. 类型安全：TypeScript 会在编译时检查所有工具是否遵循统一接口
 * 2. 标准化：所有工具（bash、read、write...）都长一个样，Agent Loop 不需要关心具体实现
 * 3. 可扩展：未来添加新工具只需实现 Tool 接口即可
 */

/** JSON Schema 格式的参数定义，兼容 OpenAI function calling */
export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/** 工具参数的 JSON Schema 对象 */
export interface ToolDefinition {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

/** 工具执行函数的签名 */
export type ToolExecuteFn = (params: Record<string, unknown>) => Promise<ToolResult>;

/** 工具的完整定义 —— 每个工具都必须实现这个接口 */
export interface Tool {
  /** 工具名称，如 "bash"、"read" —— LLM 通过这个名字调用工具 */
  name: string;
  /** 工具描述 —— 告诉 LLM 这个工具能做什么 */
  description: string;
  /** 参数的 JSON Schema —— 告诉 LLM 调用时需要传什么参数 */
  parameters: ToolDefinition;
  /** 执行函数 —— 工具被调用时实际运行的逻辑 */
  execute: ToolExecuteFn;
}

/** 工具执行结果 */
export interface ToolResult {
  /** 输出内容 —— 会作为 observation 反馈给 LLM */
  content: string;
  /** 是否为错误结果 —— LLM 看到错误后会调整策略 */
  isError?: boolean;
}
