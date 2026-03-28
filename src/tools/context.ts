/**
 * src/tools/context.ts
 *
 * 工具执行上下文 —— 每次工具调用时由 AgentLoop 注入。
 *
 * 为什么需要 ToolContext 而不是把 workDir 写死？
 * 1. 同一个 Agent 可能在不同工作目录下执行不同任务
 * 2. Phase 3 会话管理需要传入 sessionId 等运行时信息
 * 3. 工具不需要知道 workDir 从哪来，只管用就行
 */

export interface ToolContext {
  /** 工作目录（文件工具的根路径、bash 的默认 cwd） */
  workDir: string;
  /** 当前会话 ID（v2.1: 多轮对话时传入） */
  sessionId?: string;
}
