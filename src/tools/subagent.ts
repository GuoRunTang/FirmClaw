/**
 * src/tools/subagent.ts
 *
 * 子智能体工具 —— 允许 LLM 调用子智能体来执行子任务。
 *
 * 设计要点：
 * - LLM 通过 JSON-RPC 调用此工具，传入任务描述和可选配置
 * - SubagentManager 负责创建和管理子智能体实例
 * - 子智能体执行结果以 JSON 格式返回给父智能体
 * - 支持 allowedTools / maxTurns / timeoutMs / inheritSession 配置
 *
 * v5.3: 初始实现
 */

import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';
import type { SubagentManager } from '../agent/subagent-manager.js';

/**
 * 创建子智能体工具
 *
 * @param manager - SubagentManager 实例（由 index.ts 注入）
 * @returns Tool 实例
 */
export function createSubagentTool(manager: SubagentManager): Tool {
  return {
    name: 'subagent',
    description:
      'Spawn a sub-agent to handle a sub-task independently. ' +
      'The sub-agent runs in its own AgentLoop with its own context. ' +
      'Use this for parallel work, complex multi-step sub-tasks, or isolated operations. ' +
      'The result includes the sub-agent\'s final text response and execution statistics.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'The task description for the sub-agent. Be specific and clear about what needs to be done.',
        },
        allowedTools: {
          type: 'string',
          description:
            'Comma-separated list of tool names the sub-agent can use. ' +
            'If omitted, the sub-agent inherits all tools from the parent.',
        },
        maxTurns: {
          type: 'string',
          description:
            'Maximum number of ReAct loop turns for this sub-agent (default: 5).',
        },
        inheritSession: {
          type: 'string',
          description:
            'Set to "true" to share the parent\'s session context (default: false).',
        },
      },
      required: ['task'],
    },
    execute: async (
      params: Record<string, unknown>,
      _context: ToolContext,
    ): Promise<ToolResult> => {
      // 解析 allowedTools
      const allowedToolsRaw = params.allowedTools as string | undefined;
      const allowedTools = allowedToolsRaw
        ? allowedToolsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // 解析 maxTurns
      const maxTurnsRaw = params.maxTurns as string | undefined;
      const maxTurns = maxTurnsRaw ? parseInt(maxTurnsRaw, 10) : undefined;

      // 解析 inheritSession
      const inheritSessionRaw = params.inheritSession as string | undefined;
      const inheritSession = inheritSessionRaw === 'true';

      // 执行子智能体
      const result = await manager.spawn({
        task: params.task as string,
        allowedTools,
        maxTurns,
        inheritSession,
      });

      // 构建返回内容
      if (result.error) {
        return {
          content: JSON.stringify({
            subagentId: result.subagentId,
            status: 'failed',
            timedOut: result.timedOut,
            error: result.error,
            durationMs: result.durationMs,
          }, null, 2),
          isError: true,
        };
      }

      return {
        content: JSON.stringify({
          subagentId: result.subagentId,
          status: 'completed',
          text: result.text,
          turns: result.turns,
          toolCalls: result.toolCalls,
          durationMs: result.durationMs,
        }, null, 2),
      };
    },
  };
}
