/**
 * src/skills/types.ts
 *
 * Skill 系统的类型定义。
 *
 * v7.0: 初始实现
 */

/** SKILL.md frontmatter 解析结果 */
export interface SkillMeta {
  /** 技能名称（小写字母、数字、连字符） */
  name: string;
  /** 技能描述（用于自动匹配和菜单展示） */
  description: string;
  /** 参数提示文本（用于 CLI 补全） */
  argumentHint?: string;
  /** 是否禁用 LLM 自动调用（默认 false） */
  disableModelInvocation?: boolean;
  /** 是否在 /skill 菜单中显示（默认 true） */
  userInvocable?: boolean;
  /** 激活时可用的工具白名单（为空则不限制） */
  allowedTools?: string[];
  /** 引用的 MCP Server 名称列表 */
  mcpServers?: string[];
}

/** 技能来源 */
export type SkillSource = 'project' | 'user';

/** 已加载的技能 */
export interface Skill {
  /** 解析后的元数据 */
  meta: SkillMeta;
  /** Markdown 指令内容（原始，未替换变量） */
  prompt: string;
  /** 技能来源 */
  source: SkillSource;
  /** 技能目录路径 */
  dirPath: string;
  /** 技能中引用的附属文件路径列表 */
  references: string[];
}

/** 技能目录配置 */
export interface SkillDirectory {
  /** 目录路径 */
  path: string;
  /** 目录类型 */
  type: SkillSource;
  /** 搜索的子目录名 */
  searchDirs?: string[];
}

/** 技能激活结果 */
export interface SkillActivationResult {
  /** 激活是否成功 */
  success: boolean;
  /** 激活后的 prompt 内容（经过变量替换） */
  prompt?: string;
  /** 需要连接的 MCP Server 列表 */
  requiredMCPServers?: string[];
  /** 错误信息 */
  error?: string;
}
