/**
 * src/agent/types.ts
 *
 * 【讲解】
 * Agent 的配置和结果类型定义。
 */

/** Agent 运行配置 */
export interface AgentConfig {
  /** 系统提示词 —— 定义智能体的身份、行为规则 */
  systemPrompt: string;
  /** 单次 run 的最大循环轮次（防止无限循环） */
  maxTurns: number;
}

/** Agent 一次运行的结果 */
export interface AgentResult {
  /** LLM 最终输出的文本 */
  text: string;
  /** 总循环轮次 */
  turns: number;
  /** 工具调用总次数 */
  toolCalls: number;
}
