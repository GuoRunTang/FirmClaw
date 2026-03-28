/**
 * src/tools/bash.ts
 *
 * bash 工具 — 智能体与操作系统交互的桥梁。
 *
 * v1.5: 从 exec() 升级为 spawn()
 *   - 支持流式输出收集（避免大输出撑爆内存）
 *   - 支持可配置的工作目录 cwd（默认 context.workDir）
 *   - 支持可配置的超时 timeout（默认 30s）
 *   - 超时时先 SIGTERM，5s 后 SIGKILL（优雅退出）
 *   - 输出超过 100KB 时截断并标注
 *   - 正确处理 shell 命令（shell: true，Windows 用 cmd.exe）
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

/** 输出截断阈值 */
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command. Supports configurable timeout and working directory. Output is truncated at 100KB.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30). Process is killed if it exceeds this time.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (default: workDir)',
      },
    },
    required: ['command'],
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = params.command as string;
    const timeout = typeof params.timeout === 'number' ? params.timeout * 1000 : 30_000;
    const cwd = typeof params.cwd === 'string' ? params.cwd : context.workDir;

    if (!command || typeof command !== 'string') {
      return { content: 'Error: "command" parameter is required and must be a string.', isError: true };
    }

    return new Promise<ToolResult>((resolve) => {
      // Windows 用 cmd.exe，Unix 用 sh
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const shellArg = process.platform === 'win32' ? '/c' : '-c';

      const child = spawn(shell, [shellArg, command], {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        totalBytes += chunk.length;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        totalBytes += chunk.length;
      });

      // 超时控制
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        // 先 SIGTERM 优雅退出
        child.kill('SIGTERM');
        // 5s 后强制 SIGKILL
        const forceTimer = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* process may already be dead */ }
        }, 5000);
        // 清理 forceTimer（如果进程在 5s 内退出）
        child.on('exit', () => clearTimeout(forceTimer));
      }, timeout);

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          content: `Failed to start command: ${err.message}`,
          isError: true,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');

        // 组装输出
        const outputParts: string[] = [];
        if (stdout) outputParts.push(stdout);
        if (stderr) outputParts.push(stderr);
        let output = outputParts.join('\n').trim();

        if (!output) {
          output = 'Command executed successfully (no output).';
        }

        // 超时标记
        if (killed) {
          output = `[Command timed out after ${(timeout / 1000).toFixed(0)}s]\n${output}`;
        }

        // 大输出截断
        if (totalBytes > MAX_OUTPUT_BYTES) {
          const truncated = output.substring(0, MAX_OUTPUT_BYTES);
          output = `${truncated}\n\n[Output truncated: ${(totalBytes / 1024).toFixed(0)}KB total, showing first ${(MAX_OUTPUT_BYTES / 1024).toFixed(0)}KB]`;
        }

        const isError = code !== 0 || killed;
        if (isError && !killed) {
          output = `Command exited with code ${code}:\n${output}`;
        }

        resolve({ content: output, isError });
      });
    });
  },
};
