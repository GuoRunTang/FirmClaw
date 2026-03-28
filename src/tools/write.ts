/**
 * src/tools/write.ts
 *
 * write_file 工具 — 让智能体能创建和覆写文件。
 *
 * 核心功能：
 * - path: 文件路径（支持相对路径，基于 context.workDir 解析）
 * - content: 写入内容（字符串）
 * - createDirs: 自动创建父目录（默认 true）
 * - 不允许写入路径指向目录（必须指定具体文件名）
 * - 输出写入的字节数
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

export const writeTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories automatically. Overwrites if file exists.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to write (relative to workDir or absolute)',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      createDirs: {
        type: 'boolean',
        description: 'Auto-create parent directories if they don\'t exist (default: true)',
      },
    },
    required: ['path', 'content'],
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = params.path as string;
    const content = params.content as string;
    const createDirs = params.createDirs !== false; // 默认 true

    // 参数校验（ajv 已校验 required，这里做运行时类型守卫）
    if (!filePath || typeof filePath !== 'string') {
      return { content: 'Error: "path" must be a non-empty string.', isError: true };
    }
    if (content === undefined || content === null) {
      return { content: 'Error: "content" is required.', isError: true };
    }

    // 解析路径
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(context.workDir, filePath);

    // 路径指向已存在的目录 → 拒绝
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return {
          content: `Error: "${resolvedPath}" is a directory. Specify a file path instead.`,
          isError: true,
        };
      }
    }

    // 自动创建父目录
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      if (createDirs) {
        fs.mkdirSync(dir, { recursive: true });
      } else {
        return {
          content: `Error: Parent directory does not exist: "${dir}". Set createDirs to true to auto-create.`,
          isError: true,
        };
      }
    }

    // 写入文件
    try {
      const contentStr = String(content);
      fs.writeFileSync(resolvedPath, contentStr, 'utf-8');
      const bytes = Buffer.byteLength(contentStr, 'utf-8');
      return {
        content: `Successfully wrote ${bytes} bytes to "${resolvedPath}".`,
      };
    } catch (error: unknown) {
      return {
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
};
