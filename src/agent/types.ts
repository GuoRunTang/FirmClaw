/**
 * src/agent/types.ts
 *
 * Agent 配置和结果的类型定义。
 *
 * v1.0: 基础 AgentConfig + AgentResult
 * v1.1: AgentConfig 新增 workDir 字段
 */

/** Agent 循环的配置 */
export interface AgentConfig {
  /** 系统提示词 */
  systemPrompt: string;
  /** 最大循环轮次（防止无限循环） */
  maxTurns: number;
  /** 工作目录（文件/bash 工具的根路径），默认 process.cwd() */
  workDir?: string;
}

/** Agent 循环的返回结果 */
export interface AgentResult {
  /** LLM 的最终文本回复 */
  text: string;
  /** 总循环轮次 */
  turns: number;
  /** 总工具调用次数 */
  toolCalls: number;
}
