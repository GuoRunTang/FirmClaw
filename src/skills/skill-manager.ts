/**
 * src/skills/skill-manager.ts
 *
 * 技能管理器 — 负责 Skill 的发现、加载、匹配和激活。
 *
 * v7.0: 初始实现
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Skill, SkillDirectory, SkillActivationResult } from './types.js';
import { SkillParser } from './skill-parser.js';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private parser = new SkillParser();

  /**
   * 从多个目录加载技能
   *
   * 加载规则：
   * 1. 扫描 <dir>/skills/<name>/SKILL.md（Claude Code 新格式）
   * 2. 扫描 <dir>/commands/<name>.md（Claude Code 旧格式）
   * 3. 项目级同名技能覆盖用户级
   */
  async loadFromDirs(directories: SkillDirectory[]): Promise<number> {
    let loaded = 0;

    for (const dir of directories) {
      const searchDirs = dir.searchDirs || ['skills', 'commands'];

      for (const searchDir of searchDirs) {
        const searchPath = path.join(dir.path, searchDir);

        if (!fs.existsSync(searchPath)) continue;

        if (searchDir === 'skills') {
          // skills/<name>/SKILL.md 格式
          loaded += await this.loadSkillsDir(searchPath, dir.type);
        } else if (searchDir === 'commands') {
          // commands/<name>.md 格式
          loaded += await this.loadCommandsDir(searchPath, dir.type);
        }
      }
    }

    return loaded;
  }

  /**
   * 获取所有用户可调用的技能
   * 用于 /skill-list 命令展示
   */
  listUserInvocable(): Skill[] {
    return this.getFilteredSkills(s => s.meta.userInvocable !== false);
  }

  /**
   * 获取所有可自动调用的技能
   * 用于 AgentLoop 在每轮对话开始时判断
   */
  listAutoInvocable(): Skill[] {
    return this.getFilteredSkills(s =>
      s.meta.disableModelInvocation !== true && !!s.meta.description,
    );
  }

  /**
   * 根据用户输入匹配最佳技能
   *
   * 匹配策略：
   * 1. 精确匹配：用户输入包含技能名称
   * 2. 关键词匹配：description 中包含用户输入的关键词
   *
   * @returns 匹配到的技能，未匹配则返回 null
   */
  matchSkill(userMessage: string): Skill | null {
    const autoInvocable = this.listAutoInvocable();
    if (autoInvocable.length === 0) return null;

    const normalizedInput = userMessage.toLowerCase().trim();
    if (!normalizedInput) return null;

    // 1. 精确匹配：用户输入包含技能名称
    for (const skill of autoInvocable) {
      if (normalizedInput.includes(skill.meta.name.toLowerCase())) {
        return skill;
      }
    }

    // 2. 关键词匹配：description 中包含用户输入的关键词
    //    提取用户输入中的关键词（2字以上），与 description 做交集
    const inputKeywords = this.extractKeywords(normalizedInput);
    if (inputKeywords.length === 0) return null;

    let bestMatch: Skill | null = null;
    let bestScore = 0;

    for (const skill of autoInvocable) {
      const desc = skill.meta.description.toLowerCase();
      let score = 0;

      for (const keyword of inputKeywords) {
        if (desc.includes(keyword)) {
          score += keyword.length; // 更长的关键词权重更高
        }
      }

      if (score > bestScore && score >= 2) {
        bestScore = score;
        bestMatch = skill;
      }
    }

    return bestMatch;
  }

  /**
   * 激活技能
   *
   * 流程：
   * 1. 查找技能
   * 2. 替换 $ARGUMENTS 变量
   * 3. 加载附属文件（如果有引用）
   * 4. 返回最终 prompt 内容
   *
   * @param skillName - 技能名称
   * @param args - 用户传入的参数
   */
  activateSkill(skillName: string, args?: string): SkillActivationResult {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: "${skillName}"`,
      };
    }

    // 替换变量
    let prompt = this.parser.replaceVariables(skill.prompt, args);

    // 加载附属文件
    const references = skill.references;
    for (const refPath of references) {
      if (fs.existsSync(refPath)) {
        try {
          const refContent = fs.readFileSync(refPath, 'utf-8');
          prompt += `\n\n## Reference: ${path.basename(refPath)}\n${refContent}`;
        } catch {
          // 附属文件加载失败不影响主流程
        }
      }
    }

    return {
      success: true,
      prompt,
      requiredMCPServers: skill.meta.mcpServers,
    };
  }

  /** 获取指定名称的技能 */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** 获取所有已加载技能 */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 检查指定技能是否存在 */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** 获取已加载技能数量 */
  size(): number {
    return this.skills.size;
  }

  /**
   * 扫描 skills/<name>/SKILL.md 目录
   */
  private async loadSkillsDir(searchPath: string, source: Skill['source']): Promise<number> {
    let loaded = 0;

    try {
      const entries = fs.readdirSync(searchPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = path.join(searchPath, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;

        try {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const { meta, body } = this.parser.parse(content);
          const dirPath = path.join(searchPath, entry.name);

          // 查找附属文件
          const references = this.findReferenceFiles(dirPath, skillFile);

          const skill: Skill = {
            meta,
            prompt: body,
            source,
            dirPath,
            references,
          };

          // 项目级覆盖用户级
          if (!this.skills.has(meta.name) || source === 'project') {
            this.skills.set(meta.name, skill);
          }

          loaded++;
        } catch {
          // 单个 skill 解析失败不影响其他
        }
      }
    } catch {
      // 目录不存在或不可读
    }

    return loaded;
  }

  /**
   * 扫描 commands/<name>.md 目录
   */
  private async loadCommandsDir(searchPath: string, source: Skill['source']): Promise<number> {
    let loaded = 0;

    try {
      const entries = fs.readdirSync(searchPath);

      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;

        const filePath = path.join(searchPath, entry);
        const name = entry.replace(/\.md$/, '');

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const { meta, body } = this.parser.parseCommand(content, name);

          const skill: Skill = {
            meta,
            prompt: body,
            source,
            dirPath: searchPath,
            references: [],
          };

          // 项目级覆盖用户级
          if (!this.skills.has(meta.name) || source === 'project') {
            this.skills.set(meta.name, skill);
          }

          loaded++;
        } catch {
          // 单个 command 解析失败不影响其他
        }
      }
    } catch {
      // 目录不存在或不可读
    }

    return loaded;
  }

  /**
   * 查找技能目录中的附属文件
   *
   * 查找规则：
   * - 同目录下的 *.md 文件（排除 SKILL.md）
   * - examples/ 子目录下的文件
   */
  private findReferenceFiles(dirPath: string, skillFile: string): string[] {
    const references: string[] = [];

    try {
      const entries = fs.readdirSync(dirPath);

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);

        // 跳过 SKILL.md 本身和子目录（examples 除外）
        if (fullPath === skillFile) continue;

        if (entry === 'examples' && fs.statSync(fullPath).isDirectory()) {
          // examples/ 下的所有 .md 文件
          const exampleEntries = fs.readdirSync(fullPath);
          for (const ex of exampleEntries) {
            if (ex.endsWith('.md')) {
              references.push(path.join(fullPath, ex));
            }
          }
        } else if (entry.endsWith('.md') && fs.statSync(fullPath).isFile()) {
          references.push(fullPath);
        }
      }
    } catch {
      // 忽略
    }

    return references;
  }

  /**
   * 提取关键词（中文按字，英文按词）
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];

    // 提取英文单词（2字符以上）
    const englishWords = text.match(/[a-zA-Z]{2,}/g);
    if (englishWords) {
      keywords.push(...englishWords.map(w => w.toLowerCase()));
    }

    // 提取中文词组（2-4字的连续中文）
    const chineseSegments = text.match(/[\u4e00-\u9fff]{2,4}/g);
    if (chineseSegments) {
      keywords.push(...chineseSegments);
    }

    return keywords;
  }

  /**
   * 获取经过过滤的技能列表
   */
  private getFilteredSkills(predicate: (skill: Skill) => boolean): Skill[] {
    return this.getAll().filter(predicate);
  }
}
