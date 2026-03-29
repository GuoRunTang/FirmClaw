/**
 * src/session/memory-manager.ts
 *
 * 记忆管理系统 —— 结构化管理 MEMORY.md。
 *
 * 功能：
 * - 读取/解析 MEMORY.md（如果存在）
 * - 添加/删除/更新记忆条目
 * - 按标签分类查询
 * - 获取格式化的记忆文本（供系统提示词注入）
 *
 * 记忆存储格式（MEMORY.md）：
 *   # 长期记忆
 *
 *   ## 偏好
 *   - [P001] 用户偏好 pnpm 而非 npm (2026-03-28)
 *   - [P002] 代码注释使用中文 (2026-03-28)
 *
 *   ## 技术决策
 *   - [T001] 项目使用 TypeScript strict 模式 (2026-03-28)
 *
 *   ## 待办
 *   - [D001] 实现向量搜索模块 (2026-03-28)
 *
 *   ## 知识
 *   - [K001] FirmClaw 使用 ReAct 架构 (2026-03-28)
 *
 * v3.2: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** 记忆标签 */
export type MemoryTag = 'preference' | 'decision' | 'todo' | 'knowledge';

/** 单条记忆 */
export interface MemoryEntry {
  /** 唯一 ID（如 P001） */
  id: string;
  /** 标签 */
  tag: MemoryTag;
  /** 记忆内容 */
  content: string;
  /** 创建/更新日期 (YYYY-MM-DD) */
  date: string;
}

/** 记忆管理器配置 */
export interface MemoryManagerConfig {
  /** 工作目录 */
  workDir: string;
  /** .firmclaw 目录名（默认 .firmclaw） */
  configDirName?: string;
}

/** 标签到 Markdown 标题的映射 */
const TAG_HEADERS: Record<MemoryTag, string> = {
  preference: '偏好',
  decision: '技术决策',
  todo: '待办',
  knowledge: '知识',
};

/** 标签到 ID 前缀的映射 */
const TAG_PREFIXES: Record<MemoryTag, string> = {
  preference: 'P',
  decision: 'T',
  todo: 'D',
  knowledge: 'K',
};

/** 标签到 MemoryTag 的反向映射（用于解析） */
const PREFIX_TO_TAG: Record<string, MemoryTag> = {
  P: 'preference',
  T: 'decision',
  D: 'todo',
  K: 'knowledge',
};

/** 解析单条记忆行的正则 */
const ENTRY_REGEX = /^- \[([A-Z])(\d{3})\]\s+(.+?)\s+\((\d{4}-\d{2}-\d{2})\)$/;

export class MemoryManager {
  private config: MemoryManagerConfig;
  private memoryPath: string;
  private entries: Map<string, MemoryEntry>;

  constructor(config: MemoryManagerConfig) {
    this.config = config;
    const dirName = this.config.configDirName || '.firmclaw';
    this.memoryPath = path.join(this.config.workDir, dirName, 'MEMORY.md');
    this.entries = new Map();
  }

  /** 获取 MEMORY.md 的文件路径 */
  getMemoryPath(): string {
    return this.memoryPath;
  }

  /** 加载 MEMORY.md（不存在则返回空） */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.memoryPath, 'utf-8');
      this.entries = new Map();
      const parsed = this.parse(content);
      for (const entry of parsed) {
        this.entries.set(entry.id, entry);
      }
    } catch {
      // 文件不存在或读取失败，返回空
      this.entries = new Map();
    }
  }

  /** 保存所有记忆到 MEMORY.md */
  async save(): Promise<void> {
    const dir = path.dirname(this.memoryPath);
    await fs.mkdir(dir, { recursive: true });
    const content = this.serialize();
    await fs.writeFile(this.memoryPath, content, 'utf-8');
  }

  /** 添加一条记忆 */
  async add(tag: MemoryTag, content: string): Promise<MemoryEntry> {
    const id = this.nextId(tag);
    const today = new Date().toISOString().slice(0, 10);
    const entry: MemoryEntry = { id, tag, content, date: today };
    this.entries.set(id, entry);
    await this.save();
    return entry;
  }

  /** 删除一条记忆 */
  async remove(id: string): Promise<boolean> {
    if (!this.entries.has(id)) return false;
    this.entries.delete(id);
    await this.save();
    return true;
  }

  /** 获取所有记忆 */
  getAll(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /** 按标签筛选 */
  getByTag(tag: MemoryTag): MemoryEntry[] {
    return this.getAll().filter(e => e.tag === tag);
  }

  /** 获取格式化的记忆文本（用于注入系统提示词） */
  getFormatted(): string {
    if (this.entries.size === 0) return '';

    const lines: string[] = ['# 长期记忆', ''];

    for (const tag of Object.keys(TAG_HEADERS) as MemoryTag[]) {
      const entries = this.getByTag(tag);
      if (entries.length === 0) continue;

      lines.push(`## ${TAG_HEADERS[tag]}`);
      for (const e of entries) {
        lines.push(`- [${e.id}] ${e.content} (${e.date})`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }

  /** 生成下一个可用 ID */
  private nextId(tag: MemoryTag): string {
    const prefix = TAG_PREFIXES[tag];
    let maxNum = 0;

    for (const [id] of this.entries) {
      if (id.startsWith(prefix)) {
        const numStr = id.slice(prefix.length);
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
  }

  /**
   * 解析 MEMORY.md 内容
   *
   * 容错设计：
   * - 无法解析的行自动跳过
   * - 空文件/损坏文件返回空数组
   */
  private parse(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(ENTRY_REGEX);
      if (!match) continue;

      const [, prefix, numStr, contentStr, dateStr] = match;
      const tag = PREFIX_TO_TAG[prefix];
      if (!tag) continue;

      entries.push({
        id: `${prefix}${numStr}`,
        tag,
        content: contentStr,
        date: dateStr,
      });
    }

    return entries;
  }

  /** 序列化为 MEMORY.md 格式 */
  private serialize(): string {
    if (this.entries.size === 0) {
      return '# 长期记忆\n\n（暂无记忆）\n';
    }

    const lines: string[] = ['# 长期记忆', ''];

    for (const tag of Object.keys(TAG_HEADERS) as MemoryTag[]) {
      const entries = this.getByTag(tag);
      if (entries.length === 0) continue;

      lines.push(`## ${TAG_HEADERS[tag]}`);
      for (const e of entries) {
        lines.push(`- [${e.id}] ${e.content} (${e.date})`);
      }
      lines.push('');
    }

    return lines.join('\n') + '\n';
  }
}
