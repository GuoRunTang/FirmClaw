/**
 * src/tools/bash.ts
 *
 * bash 工具 — 智能体与操作系统交互的桥梁。
 *
 * v1.0: exec() + 超时 + maxBuffer
 * v1.1: 适配 ToolContext（使用 context.workDir 作为 cwd）
 *       （v1.5 会升级为 spawn()，这里先用 exec + cwd 选项过渡）
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

const execAsync = promisify(exec);

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command and return stdout and stderr output. The working directory defaults to workDir.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
    },
    required: ['command'],
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = params.command as string;

    if (!command || typeof command !== 'string') {
      return { content: 'Error: "command" parameter is required and must be a string.', isError: true };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        cwd: context.workDir,
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
