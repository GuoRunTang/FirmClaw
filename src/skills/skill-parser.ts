/**
 * src/skills/skill-parser.ts
 *
 * SKILL.md 文件解析器 — 解析 frontmatter 和 Markdown 内容。
 *
 * v7.0: 初始实现
 */

import type { SkillMeta } from './types.js';

/** YAML frontmatter + Markdown body 解析结果 */
export interface ParsedSkill {
  meta: SkillMeta;
  body: string;
}

export class SkillParser {
  /**
   * 解析 SKILL.md 文件内容
   *
   * 格式：YAML frontmatter（---包裹）+ Markdown 正文
   *
   * @param content - 文件原始内容
   * @returns { meta, body } 元数据和正文内容
   * @throws 当 frontmatter 格式无效时抛出
   */
  parse(content: string): ParsedSkill {
    const trimmed = content.trim();

    // 检查是否有 frontmatter
    if (!trimmed.startsWith('---')) {
      throw new Error('Invalid SKILL.md: missing YAML frontmatter (must start with ---)');
    }

    // 找到 frontmatter 结束位置
    const endIndex = trimmed.indexOf('---', 3);
    if (endIndex === -1) {
      throw new Error('Invalid SKILL.md: missing closing --- for YAML frontmatter');
    }

    const yamlStr = trimmed.slice(3, endIndex).trim();
    const body = trimmed.slice(endIndex + 3).trim();

    // 解析 YAML（简易解析器，支持常见格式）
    const meta = this.parseYaml(yamlStr);

    if (!meta.name) {
      throw new Error('Invalid SKILL.md: "name" is required in frontmatter');
    }

    return { meta, body };
  }

  /**
   * 解析旧版 commands 文件（无 frontmatter）
   *
   * @param content - 文件内容
   * @param name - 从文件名派生的技能名称
   * @returns 元数据（全部使用默认值）和正文内容
   */
  parseCommand(content: string, name: string): ParsedSkill {
    return {
      meta: {
        name,
        description: `Command: ${name}`,
        disableModelInvocation: true,
        userInvocable: true,
      },
      body: content.trim(),
    };
  }

  /**
   * 替换模板变量
   *
   * 支持变量：
   * - $ARGUMENTS — 全部参数
   * - $ARGUMENTS[N] / $N — 索引参数
   */
  replaceVariables(body: string, args?: string): string {
    if (!args) {
      // 没有参数时，将 $ARGUMENTS 替换为空字符串
      return body.replace(/\$ARGUMENTS/g, '').replace(/\$\d+/g, '');
    }

    const parts = args.split(/\s+/);

    let result = body;

    // 替换 $ARGUMENTS — 全部参数
    result = result.replace(/\$ARGUMENTS/g, args);

    // 替换 $ARGUMENTS[N] 和 $N 索引变量
    result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, index) => {
      const i = parseInt(index, 10);
      return parts[i] ?? '';
    });

    result = result.replace(/\$(\d+)/g, (_, index) => {
      const i = parseInt(index, 10);
      return parts[i] ?? '';
    });

    return result;
  }

  /**
   * 简易 YAML 解析器
   *
   * 支持：
   * - 简单键值对: key: value
   * - 列表: - item
   * - 多行字符串: >
   */
  private parseYaml(yamlStr: string): SkillMeta {
    const lines = yamlStr.split('\n');
    const meta: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let multilineValue: string[] = [];
    let multilineIndicator: string | null = null;

    for (const line of lines) {
      // 多行字符串续行（缩进行）
      if (multilineIndicator && (line.startsWith('  ') || line.startsWith('\t') || line === '')) {
        multilineValue.push(line.trim());
        continue;
      }

      // 多行字符串结束
      if (multilineIndicator) {
        meta[currentKey!] = multilineValue.join('\n');
        multilineIndicator = null;
        currentKey = null;
        multilineValue = [];
      }

      // 空行跳过
      if (line.trim() === '' || line.trim().startsWith('#')) continue;

      // 列表项
      if (line.match(/^\s*-\s+/)) {
        const value = line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, '');
        if (currentKey) {
          if (!Array.isArray(meta[currentKey])) {
            meta[currentKey] = [];
          }
          (meta[currentKey] as string[]).push(value);
        }
        continue;
      }

      // 键值对
      const match = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (match) {
        currentKey = match[1].toLowerCase();
        let value = match[2].trim();

        // 多行字符串指示符
        if (value === '>' || value === '|') {
          multilineIndicator = value;
          multilineValue = [];
          continue;
        }

        // 去除引号
        value = value.replace(/^["']|["']$/g, '');

        // 布尔值转换
        if (value === 'true') {
          meta[currentKey] = true;
        } else if (value === 'false') {
          meta[currentKey] = false;
        } else if (value.match(/^\d+$/)) {
          meta[currentKey] = parseInt(value, 10);
        } else {
          meta[currentKey] = value;
        }
      }
    }

    // 处理末尾的多行字符串
    if (multilineIndicator && currentKey) {
      meta[currentKey] = multilineValue.join('\n');
    }

    return {
      name: (meta.name as string) || '',
      description: (meta.description as string) || '',
      argumentHint: meta['argument-hint'] as string | undefined,
      disableModelInvocation: meta['disable-model-invocation'] as boolean | undefined,
      userInvocable: meta['user-invocable'] as boolean | undefined,
      allowedTools: meta['allowed-tools'] as string[] | undefined,
      mcpServers: meta['mcp-servers'] as string[] | undefined,
    };
  }
}
