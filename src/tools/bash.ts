/**
 * src/tools/bash.ts
 *
 * 【讲解】
 * bash 工具是 Phase 1 唯一的工具，也是智能体与操作系统交互的桥梁。
 *
 * 工作原理：
 * 1. LLM 决定要执行一个命令 → 生成 tool_call { name: "bash", arguments: { command: "ls" } }
 * 2. Agent Loop 解析出 tool name 和 arguments
 * 3. 调用 bashTool.execute({ command: "ls" })
 * 4. Node.js 通过 child_process.exec 执行命令
 * 5. stdout/stderr 被捕获并返回给 LLM 作为 observation
 *
 * 关键设计：
 * - timeout: 30秒超时，防止命令卡死
 * - maxBuffer: 1MB 缓冲区，防止命令输出过大撑爆内存
 * - try/catch: 命令执行失败时返回错误信息而非抛异常（LLM 需要看到错误来调整策略）
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from './types.js';

const execAsync = promisify(exec);

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a bash command in the terminal and return stdout and stderr output.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
    },
    required: ['command'],
  },

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const command = params.command as string;

    if (!command || typeof command !== 'string') {
      return { content: 'Error: "command" parameter is required and must be a string.', isError: true };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30_000,       // 30秒超时
        maxBuffer: 1024 * 1024, // 1MB 输出缓冲
      });

      const output = [stdout, stderr].filter(Boolean).join('\n');
      return {
        content: output || 'Command executed successfully (no output).',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Command failed with error:\n${message}`,
        isError: true,
      };
    }
  },
};
