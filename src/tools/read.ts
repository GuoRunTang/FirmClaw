/**
 * src/tools/read.ts
 *
 * read_file 工具 — 让智能体能读取文件内容。
 *
 * 核心功能：
 * - path: 文件路径（支持相对路径，会基于 context.workDir 解析）
 * - offset: 起始行号（1-based），默认 1
 * - limit: 读取行数，默认全部
 * - 输出带行号（6位右对齐 + 冒号 + 内容）
 * - 二进制文件检测（前 8KB 含 null byte 则拒绝）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

export const readTool: Tool = {
  name: 'read_file',
  description: 'Read file contents with optional line range. Returns text with line numbers. Detects and rejects binary files.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path (relative to workDir or absolute)',
      },
      offset: {
        type: 'number',
        description: 'Start line number (1-based), default 1',
      },
      limit: {
        type: 'number',
        description: 'Number of lines to read, default all lines to end of file',
      },
    },
    required: ['path'],
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = params.path as string;
    const offset = (params.offset as number) || 1;
    const limit = (params.limit as number) || Infinity;

    if (!filePath || typeof filePath !== 'string') {
      return { content: 'Error: "path" parameter is required and must be a string.', isError: true };
    }

    // 解析路径
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(context.workDir, filePath);

    // 检查文件是否存在
    if (!fs.existsSync(resolvedPath)) {
      return { content: `Error: File not found: "${resolvedPath}"`, isError: true };
    }

    // 检查是否为文件
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return { content: `Error: "${resolvedPath}" is not a file.`, isError: true };
    }

    // 读取文件（限制最多 10MB）
    if (stat.size > 10 * 1024 * 1024) {
      return { content: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`, isError: true };
    }

    let content: Buffer;
    try {
      content = fs.readFileSync(resolvedPath);
    } catch (error: unknown) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    // 二进制检测：检查前 8KB 是否包含 null byte
    const checkLength = Math.min(content.length, 8192);
    for (let i = 0; i < checkLength; i++) {
      if (content[i] === 0) {
        return {
          content: `Error: Binary file detected (contains null bytes). Cannot read: "${resolvedPath}"`,
          isError: true,
        };
      }
    }

    // 按行分割 + 带行号输出
    const lines = content.toString('utf-8').split('\n');
    const startLine = Math.max(1, offset);
    const endLine = Math.min(lines.length, startLine - 1 + limit);

    if (startLine > lines.length) {
      return { content: `Error: offset ${startLine} exceeds file length (${lines.length} lines).`, isError: true };
    }

    const outputLines: string[] = [];
    for (let i = startLine - 1; i < endLine; i++) {
      const lineNum = String(i + 1).padStart(6, ' ');
      outputLines.push(`${lineNum}:${lines[i]}`);
    }

    const header = `File: ${resolvedPath} (lines ${startLine}-${endLine} of ${lines.length})`;
    return { content: `${header}\n${outputLines.join('\n')}` };
  },
};
