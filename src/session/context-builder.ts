/**
 * src/session/context-builder.ts
 *
 * 系统提示词组装器 —— 运行时动态生成 system prompt。
 *
 * 占位实现 —— v2.2 会完善。
 * 当前仅提供兼容接口，确保 v2.1 的 agent/types.ts 可以编译。
 */

import type { ToolRegistry } from '../tools/registry.js';
import type { SessionMeta } from './types.js';

/** ContextBuilder 配置（v2.2 完整定义） */
export interface ContextBuilderConfig {
  /** 工作目录（加载 SOUL.md 等的位置） */
  workDir: string;
  /** .firmclaw 目录名（默认 .firmclaw） */
  configDirName?: string;
  /** 自定义模板路径（可选，覆盖内置模板） */
  customTemplate?: string;
}

export class ContextBuilder {
  private config: ContextBuilderConfig;

  constructor(config: ContextBuilderConfig) {
    this.config = config;
  }

  /**
   * 构建完整的系统提示词
   * v2.2 完整实现：加载 SOUL.md、注入工具定义、注入会话信息
   */
  async build(_tools: ToolRegistry, _sessionMeta?: SessionMeta): Promise<string> {
    // v2.1 占位：返回默认提示词
    // v2.2 会替换为完整的动态组装逻辑
    return '你是一个本地 AI 智能体助手。';
  }
}
