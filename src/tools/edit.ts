/**
 * src/tools/edit.ts
 *
 * edit_file 工具 — 精确的查找替换编辑。
 *
 * 核心功能：
 * - path: 文件路径（基于 context.workDir 解析）
 * - old_str: 要被替换的文本（必须在文件中唯一出现）
 * - new_str: 替换后的文本
 *
 * 设计理念：
 * - "唯一性校验" 是最关键的安全保障 —— 如果 old_str 出现多次，
 *   说明匹配不够精确，强制拒绝，让 LLM 提供更多上下文来唯一标识。
 * - 保留原文件的换行风格（不自动转换 \r\n vs \n）
 * - 返回替换统计信息（行数、字符数变化）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';

export const editTool: Tool = {
  name: 'edit_file',
  description: 'Find and replace text in a file. old_str must be unique in the file. Use enough context in old_str to ensure uniqueness.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to edit (relative to workDir or absolute)',
      },
      old_str: {
        type: 'string',
        description: 'Text to find and replace (must appear exactly once in the file)',
      },
      new_str: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['path', 'old_str', 'new_str'],
  },

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = params.path as string;
    const oldStr = params.old_str as string;
    const newStr = params.new_str as string;

    // 参数校验
    if (!filePath || typeof filePath !== 'string') {
      return { content: 'Error: "path" must be a non-empty string.', isError: true };
    }
    if (oldStr === undefined || oldStr === null) {
      return { content: 'Error: "old_str" is required.', isError: true };
    }
    if (newStr === undefined || newStr === null) {
      return { content: 'Error: "new_str" is required.', isError: true };
    }
    if (oldStr === '') {
      return { content: 'Error: "old_str" must not be empty. Use write_file to create new files.', isError: true };
    }

    // 解析路径
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(context.workDir, filePath);

    // 检查文件存在
    if (!fs.existsSync(resolvedPath)) {
      return { content: `Error: File not found: "${resolvedPath}"`, isError: true };
    }

    // 读取文件
    let content: string;
    try {
      content = fs.readFileSync(resolvedPath, 'utf-8');
    } catch (error: unknown) {
      return {
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    // 计算出现次数
    const occurrences = countOccurrences(content, oldStr);

    if (occurrences === 0) {
      return {
        content: `Error: old_str not found in "${resolvedPath}". The text to replace does not exist in the file.`,
        isError: true,
      };
    }

    if (occurrences > 1) {
      return {
        content: `Error: old_str appears ${occurrences} times in "${resolvedPath}". It must be unique. Provide more surrounding context to make it unique.`,
        isError: true,
      };
    }

    // 执行替换
    try {
      const newContent = content.replace(oldStr, newStr);
      fs.writeFileSync(resolvedPath, newContent, 'utf-8');

      // 计算统计信息
      const oldLines = oldStr.split('\n').length;
      const newLines = newStr.split('\n').length;
      const lineDiff = newLines - oldLines;
      const charDiff = newStr.length - oldStr.length;

      const stats: string[] = [
        `Successfully edited "${resolvedPath}".`,
        `Replaced ${oldStr.length} chars with ${newStr.length} chars (diff: ${charDiff > 0 ? '+' : ''}${charDiff}).`,
        `Lines: ${oldLines} → ${newLines} (diff: ${lineDiff > 0 ? '+' : ''}${lineDiff}).`,
      ];

      return { content: stats.join('\n') };
    } catch (error: unknown) {
      return {
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  },
};

/**
 * 统计 subStr 在 str 中非重叠出现的次数
 */
function countOccurrences(str: string, subStr: string): number {
  if (subStr.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(subStr, pos)) !== -1) {
    count++;
    pos += subStr.length;
  }
  return count;
}
