/**
 * src/session/context-builder.ts
 *
 * 系统提示词组装器 —— 运行时动态生成 system prompt。
 *
 * 核心思路：
 * 1. 加载工作区文件（SOUL.md / AGENTS.md / MEMORY.md）
 * 2. 注入工具定义
 * 3. 注入会话信息
 * 4. 通过模板引擎组装最终提示词
 *
 * v2.2: 完整实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolRegistry } from '../tools/registry.js';
import type { SessionMeta } from './types.js';
import { renderTemplate } from '../utils/prompt-template.js';

/** ContextBuilder 配置 */
export interface ContextBuilderConfig {
  /** 工作目录（加载 SOUL.md 等的位置） */
  workDir: string;
  /** .firmclaw 目录名（默认 .firmclaw） */
  configDirName?: string;
  /** 自定义模板路径（可选，覆盖内置模板） */
  customTemplate?: string;
}

/** 内置系统提示词模板 */
const DEFAULT_TEMPLATE = `{{#soul}}{{soul}}

---
{{/soul}}你是一个本地 AI 智能体助手，可以读取/写入/编辑文件和执行终端命令来帮助用户完成任务。

## 可用工具
{{tools}}

## 工作方式
1. 理解用户的需求
2. 优先使用 read_file 读取文件（比 bash cat 更精确）
3. 使用 write_file 创建新文件
4. 使用 edit_file 修改现有文件（比 write_file 覆写更安全）
5. 使用 bash 执行命令来获取动态信息或完成任务
6. 根据结果分析并给出清晰的最终答案

## 注意事项
- 在执行操作前，先说明你打算做什么
- edit_file 的 old_str 必须足够独特以确保唯一性
- 如果 edit_file 因非唯一匹配失败，扩大 old_str 的范围重试
- 如果操作失败，分析错误原因并尝试其他方法
- 使用中文回复
- 回答要简洁直接，不要多余的客套话
{{#agents}}

## 协作规则
{{agents}}
{{/agents}}
{{#session}}

## 当前会话
- 会话 ID: {{sessionId}}
- 创建时间: {{createdAt}}
- 历史消息数: {{messageCount}}
- 工作目录: {{workDir}}
{{/session}}
{{#memory}}

## 长期记忆
{{memory}}
{{/memory}}`;

export class ContextBuilder {
  private config: ContextBuilderConfig;

  constructor(config: ContextBuilderConfig) {
    this.config = config;
  }

  /**
   * 构建完整的系统提示词
   *
   * @param tools - 工具注册表（用于注入工具定义）
   * @param sessionMeta - 当前会话元数据（可选）
   */
  async build(tools: ToolRegistry, sessionMeta?: SessionMeta): Promise<string> {
    // 加载模板
    const template = await this.loadTemplate();

    // 加载工作区文件
    const soul = await this.loadWorkspaceFile('SOUL.md');
    const agents = await this.loadWorkspaceFile('AGENTS.md');
    const memory = await this.loadWorkspaceFile('MEMORY.md');

    // 构建工具描述段
    const toolsSection = this.buildToolsSection(tools);

    // 构建会话信息段
    const sessionSection = sessionMeta ? this.buildSessionSection(sessionMeta) : '';

    // 组装模板上下文
    const context: Record<string, unknown> = {
      soul: soul || undefined,
      agents: agents || undefined,
      memory: memory || undefined,
      tools: toolsSection,
      // 条件块变量
      session: sessionMeta ? 'active' : undefined,
      // 会话字段
      sessionId: sessionMeta?.id || undefined,
      createdAt: sessionMeta?.createdAt || undefined,
      messageCount: sessionMeta?.messageCount || undefined,
      workDir: sessionMeta?.workDir || undefined,
    };

    return renderTemplate(template, context);
  }

  /** 加载模板（自定义 > 内置） */
  private async loadTemplate(): Promise<string> {
    if (this.config.customTemplate) {
      try {
        return await fs.readFile(this.config.customTemplate, 'utf-8');
      } catch {
        // 自定义模板不存在，使用内置模板
      }
    }
    return DEFAULT_TEMPLATE;
  }

  /**
   * 加载工作区文件
   *
   * @param fileName - 文件名（如 SOUL.md）
   * @returns 文件内容，不存在则返回 null
   */
  async loadWorkspaceFile(fileName: string): Promise<string | null> {
    const dirName = this.config.configDirName || '.firmclaw';
    const filePath = path.join(this.config.workDir, dirName, fileName);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim();
    } catch {
      return null;
    }
  }

  /** 生成工具描述段 */
  private buildToolsSection(tools: ToolRegistry): string {
    const toolList = tools.getAll();

    if (toolList.length === 0) {
      return '（无可用工具）';
    }

    return toolList.map(tool => {
      let desc = `- **${tool.name}**: ${tool.description}`;
      // 附加参数信息
      const params = Object.entries(tool.parameters.properties);
      if (params.length > 0) {
        const paramStr = params
          .map(([name, param]) => {
            const required = tool.parameters.required?.includes(name) ? '（必填）' : '（可选）';
            return `    - \`${name}\` ${required}: ${param.description}`;
          })
          .join('\n');
        desc += '\n' + paramStr;
      }
      return desc;
    }).join('\n');
  }

  /** 生成会话信息段 */
  private buildSessionSection(meta: SessionMeta): string {
    return [
      `- 会话 ID: ${meta.id}`,
      `- 创建时间: ${meta.createdAt}`,
      `- 历史消息数: ${meta.messageCount}`,
      `- 工作目录: ${meta.workDir}`,
    ].join('\n');
  }
}
