/**
 * src/agent/types.ts
 *
 * Agent 配置和结果的类型定义。
 *
 * v1.0: 基础 AgentConfig + AgentResult
 * v1.1: AgentConfig 新增 workDir 字段
 * v2.1: AgentConfig 新增 session 相关字段
 * v2.3: AgentConfig 新增 contextBuilder / tokenCounter / trimConfig
 */

import type { SessionManager } from '../session/manager.js';
import type { ContextBuilder } from '../session/context-builder.js';
import type { TokenCounter } from '../utils/token-counter.js';
import type { TrimConfig } from '../utils/token-counter.js';

/** Agent 循环的配置 */
export interface AgentConfig {
  /** 系统提示词（当 contextBuilder 未设置时使用） */
  systemPrompt: string;
  /** 最大循环轮次（防止无限循环） */
  maxTurns: number;
  /** 工作目录（文件/bash 工具的根路径），默认 process.cwd() */
  workDir?: string;
  /** 会话管理器（v2.1: 可选，设置后启用会话持久化） */
  sessionManager?: SessionManager;
  /** 系统提示词组装器（v2.2: 可选，设置后动态生成 system prompt） */
  contextBuilder?: ContextBuilder;
  /** Token 计数器（v2.3: 可选，设置后启用上下文裁剪） */
  tokenCounter?: TokenCounter;
  /** 上下文裁剪配置（v2.3: 仅在 tokenCounter 设置时生效） */
  trimConfig?: TrimConfig;
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
