/**
 * src/tools/types.ts
 *
 * 工具系统的类型定义文件。
 *
 * v1.0: 基础 Tool / ToolDefinition / ToolResult 接口
 * v1.1: ToolExecuteFn 新增 context 参数，支持 ToolContext 注入
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

/** 工具执行函数的签名（v1.1: 新增 context 参数） */
export type ToolExecuteFn = (params: Record<string, unknown>, context: import('./context.js').ToolContext) => Promise<ToolResult>;

/** 工具的完整定义 —— 每个工具都必须实现这个接口 */
export interface Tool {
  /** 工具名称，如 "bash"、"read_file" —— LLM 通过这个名字调用工具 */
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
