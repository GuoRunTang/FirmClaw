# FirmClaw Phase 4 设计文档

> **状态**: 设计中
> **基于**: v2.4.0 (Phase 1 + Phase 2 + Phase 3 完成)
> **目标版本**: v3.4.0
> **前置版本**: v3.0.0 → v3.1.0 → v3.2.0 → v3.3.0 → v3.4.0

---

## 一、Phase 4 目标

**让 FirmClaw 支持长对话不丢失关键信息，并具备结构化记忆和全文搜索能力。**

当前（v2.4）的上下文管理仅做简单的 tool 结果截断 + 旧消息移除，被移除的信息永久丢失。Phase 4 将实现：

1. **LLM 摘要压缩**：对话过长时，调用 LLM 将旧消息压缩为摘要，保留关键决策和结论
2. **记忆管理系统**：结构化读写 MEMORY.md，支持自动提取和手动管理记忆条目
3. **全文搜索引擎**：纯 JS 实现 BM25 算法，支持跨会话、跨模块的全文检索
4. **记忆集成**：搜索结果和记忆可自动注入系统提示词，增强智能体的长期记忆能力

---

## 二、设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 摘要压缩方式 | **LLM 摘要（调用现有 LLM 客户端）** | 复用已有的 LLMClient，不引入额外依赖；摘要质量高于规则裁剪 |
| 摘要触发策略 | **token 阈值 + 滑动窗口** | 当历史消息超过阈值时，将最早 N 条消息压缩为一条 system 摘要 |
| 记忆存储格式 | **MEMORY.md（Markdown 结构化）** | 与 SOUL.md / AGENTS.md 保持一致，人工可读可编辑 |
| 全文搜索实现 | **纯 JS BM25（倒排索引）** | 不引入 SQLite / better-sqlite3 等原生依赖，保持零外部依赖原则 |
| 搜索索引存储 | **JSON 文件（内存 + 磁盘持久化）** | 轻量级，会话结束时序列化到 `~/.firmclaw/index/` |
| 记忆注入方式 | **动态注入到系统提示词** | 搜索相关记忆后，将 top-K 结果注入 `{{memory}}` 模板变量 |

---

## 三、模块架构

### 3.1 新增文件总览

```
src/
├── session/
│   ├── summarizer.ts      ← [v3.1] LLM 摘要压缩器
│   ├── memory-manager.ts  ← [v3.2] 记忆管理系统
│   └── search-engine.ts   ← [v3.3] BM25 全文搜索引擎
├── tests/
│   ├── test-summarizer.ts     ← [v3.1]
│   ├── test-memory-manager.ts ← [v3.2]
│   └── test-search-engine.ts  ← [v3.3]
```

### 3.2 修改文件

```
src/
├── agent/
│   ├── agent-loop.ts     ← [v3.1] 集成 Summarizer（摘要压缩优先于硬裁剪）
│   └── types.ts          ← [v3.1] AgentConfig 新增 summarizer / summarizerConfig
├── session/
│   ├── context-builder.ts ← [v3.2] build() 支持搜索相关记忆并注入
│   └── manager.ts        ← [v3.3] append 时自动更新搜索索引
├── utils/
│   └── event-stream.ts   ← [v3.1] 新增 summary_generated / memory_saved 事件
├── index.ts              ← [v3.4] 新增斜杠命令 /search /remember /forget /compact
```

### 3.3 架构图

```
                        ┌─────────────────────────────────────┐
                        │              CLI (index.ts)          │
                        │  - /search <query>   全文搜索        │
                        │  - /remember <text>  保存记忆       │
                        │  - /forget <id>      删除记忆       │
                        │  - /compact          手动压缩       │
                        │  - /memory           查看记忆       │
                        └──────────────┬──────────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────────────┐
                        │           AgentLoop (改造)            │
                        │                                     │
                        │  run(userMessage) {                  │
                        │    ① contextBuilder.build()          │
                        │       └→ searchEngine.search()       │
                        │          └→ memoryManager.getTopK()  │
                        │    ② summarizer.shouldSummarize()?   │
                        │       └→ llm.chat() → 摘要           │
                        │    ③ tokenCounter.trim()             │
                        │    ④ LLM.chat(messages) ← ReAct循环  │
                        │    ⑤ searchEngine.index() ← 结果     │
                        │  }                                  │
                        └──┬────────┬────────┬────────┬───────┘
                           │        │        │        │
                  ┌────────┘        │        │        └────────┐
                  ▼                 ▼        ▼                  ▼
    ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
    │  Summarizer      │ │  Search  │ │  Memory  │ │ 工作区文件    │
    │  (v3.1)          │ │  Engine  │ │  Manager │ │              │
    │                  │ │  (v3.3)  │ │  (v3.2)  │ │ MEMORY.md    │
    │ - shouldSummarize│ │          │ │          │ │              │
    │ - summarize()    │ │ - index  │ │ - save   │ │              │
    │ - buildSummary() │ │ - search │ │ - getTopK│ │              │
    └──────────────────┘ │ - delete │ │ - list   │ └──────────────┘
                         │ - persist│ │ - remove │
                         └──────────┘ └──────────┘
```

---

## 四、版本拆分与详细设计

### v3.1.0：LLM 摘要压缩

**目标**：当对话历史过长时，调用 LLM 将旧消息压缩为高质量摘要，替代简单截断。

#### 4.1.1 `src/session/summarizer.ts` — 摘要压缩器

设计要点：
- 复用已有的 `LLMClient`，不引入新依赖
- 摘要 prompt 要求保留：关键决策、技术方案、用户偏好、待办事项
- 摘要结果作为一条 `system` 角色的摘要消息插入，替代被压缩的原始消息
- 滑动窗口：每次摘要后，摘要成为新的"锚点"，后续继续基于摘要+新消息进行下一轮摘要

```typescript
/**
 * src/session/summarizer.ts
 *
 * LLM 摘要压缩器 —— 将旧消息压缩为高质量摘要。
 *
 * 压缩策略：
 * 1. 当历史消息的 token 数超过 summarizeThreshold 时触发
 * 2. 取最早的 N 条消息（保留摘要行如果有的话），调用 LLM 生成摘要
 * 3. 用一条 system 摘要消息替代被压缩的消息
 * 4. 摘要 prompt 明确要求保留关键决策、用户偏好、技术方案
 *
 * v3.1: 初始实现
 */

import type { Message } from '../llm/client.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { TokenCounter } from '../utils/token-counter.js';

/** 摘要器配置 */
export interface SummarizerConfig {
  /** 触发摘要的历史 token 阈值（默认 80000） */
  summarizeThreshold?: number;
  /** 每次摘要的消息条数上限（默认 50） */
  maxMessagesToSummarize?: number;
  /** 摘要的最大 token 数（默认 2000） */
  maxSummaryTokens?: number;
  /** 是否在控制台输出摘要统计 */
  verbose?: boolean;
}

/** 摘要结果 */
export interface SummaryResult {
  /** 压缩后的消息列表（摘要 + 未压缩的消息） */
  messages: Message[];
  /** 是否执行了摘要 */
  summarized: boolean;
  /** 被压缩的消息条数 */
  compressedCount: number;
  /** 摘要前的 token 数 */
  originalTokens: number;
  /** 摘要后的 token 数 */
  newTokens: number;
}

/** 内置摘要 prompt */
const SUMMARY_PROMPT = `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要。

要求：
1. 保留所有关键决策和结论（用 ✓ 标记）
2. 保留用户明确表达的偏好和要求
3. 保留重要的技术方案和实现细节
4. 保留未完成的任务或待办事项（用 ○ 标记）
5. 使用简洁的条目化格式
6. 不超过 1500 字

对话历史：
{{messages}}

请输出摘要：`;

export class Summarizer {
  private llm: LLMClient;
  private tools: ToolRegistry;
  private tokenCounter: TokenCounter;
  private config: Required<SummarizerConfig>;

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    tokenCounter: TokenCounter,
    config?: SummarizerConfig,
  );

  /**
   * 判断是否需要摘要
   *
   * @param messages - 完整消息列表（不含当前 system prompt）
   * @returns 是否超过阈值
   */
  shouldSummarize(messages: Message[]): boolean;

  /**
   * 执行摘要压缩
   *
   * 流程：
   * 1. 找到最早的可压缩消息段
   * 2. 调用 LLM 生成摘要
   * 3. 用摘要消息替代原始消息段
   *
   * @param messages - 完整消息列表
   * @returns 压缩后的消息列表 + 统计信息
   */
  async summarize(messages: Message[]): Promise<SummaryResult>;

  /**
   * 构建摘要请求（供 LLM 调用）
   *
   * @param messagesToCompress - 需要压缩的消息段
   * @returns 发送给 LLM 的 messages 数组
   */
  private buildSummaryRequest(messagesToCompress: Message[]): Message[];
}
```

#### 4.1.2 `src/agent/types.ts` — AgentConfig 扩展

```typescript
export interface AgentConfig {
  systemPrompt: string;
  maxTurns: number;
  workDir?: string;
  sessionManager?: SessionManager;
  contextBuilder?: ContextBuilder;
  tokenCounter?: TokenCounter;
  trimConfig?: TrimConfig;
  // Phase 4 新增
  summarizer?: Summarizer;             // v3.1: 摘要压缩器（可选）
  summarizerConfig?: SummarizerConfig;  // v3.1: 摘要配置
}
```

#### 4.1.3 `src/agent/agent-loop.ts` — 集成 Summarizer

改造后的上下文管理流程：

```typescript
// 在 TokenCounter.trimMessages() 之前，先尝试 LLM 摘要压缩
if (this.summarizer && this.summarizer.shouldSummarize(historyMessages)) {
  const result = await this.summarizer.summarize(historyMessages);
  if (result.summarized) {
    historyMessages = result.messages;
    this.events.emit('summary_generated', {
      compressedCount: result.compressedCount,
      originalTokens: result.originalTokens,
      newTokens: result.newTokens,
    });
  }
}

// 摘要后仍可能需要简单裁剪（摘要不够短时）
if (this.tokenCounter) {
  const trimResult = this.tokenCounter.trimMessages(allMessages, this.config.trimConfig);
  // ...
}
```

**执行优先级**：
1. LLM 摘要压缩（保留语义，高质量）
2. TokenCounter 简单裁剪（保底措施，防止摘要后仍超限）

#### 4.1.4 `src/utils/event-stream.ts` — 新增事件类型

```typescript
export type AgentEventType =
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_end'
  | 'message_end'
  | 'error'
  | 'session_start'
  | 'context_trimmed'
  | 'summary_generated'    // v3.1: 摘要生成 { compressedCount, originalTokens, newTokens }
  | 'memory_saved';        // v3.2: 记忆保存 { id, tag }
```

#### 4.1.5 测试：`src/tests/test-summarizer.ts`

| 测试用例 | 说明 |
|----------|------|
| 短对话不触发摘要 | 阈值以下不压缩 |
| 长对话触发摘要 | 超过阈值时压缩 |
| 摘要保留关键信息 | 验证摘要包含决策/偏好 |
| 摘要后 token 数减少 | 验证压缩效果 |
| 空消息列表 | 边界处理 |
| 摘要后消息结构完整 | system/user/assistant 顺序正确 |

---

### v3.2.0：记忆管理系统

**目标**：结构化管理 MEMORY.md，支持自动提取和手动管理记忆条目。

#### 4.2.1 记忆条目格式

MEMORY.md 采用结构化 Markdown 格式：

```markdown
# 长期记忆

## 偏好
- [P001] 用户偏好 pnpm 而非 npm (2026-03-28)
- [P002] 代码注释使用中文 (2026-03-28)

## 技术决策
- [T001] 项目使用 TypeScript strict 模式 (2026-03-28)
- [T002] 权限策略采用白名单 + 黑名单混合模式 (2026-03-28)

## 待办
- [D001] 实现向量搜索模块 (2026-03-28)

## 知识
- [K001] FirmClaw 使用 ReAct 架构 (2026-03-28)
- [K002] MiniMax API 兼容 OpenAI 格式 (2026-03-28)
```

每条记忆包含：
- **ID**：`[TAG + 三位数字]`，如 `[P001]`、`[T002]`
- **内容**：一行简洁描述
- **时间戳**：`(YYYY-MM-DD)`

#### 4.2.2 `src/session/memory-manager.ts` — 记忆管理器

```typescript
/**
 * src/session/memory-manager.ts
 *
 * 记忆管理系统 —— 结构化管理 MEMORY.md。
 *
 * 功能：
 * - 读取/解析 MEMORY.md（如果存在）
 * - 添加/删除/更新记忆条目
 * - 按标签分类查询
 * - 获取 top-K 相关记忆（供系统提示词注入）
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

export class MemoryManager {
  private config: MemoryManagerConfig;
  private memoryPath: string;
  private entries: Map<string, MemoryEntry>;

  constructor(config: MemoryManagerConfig);

  /** 加载 MEMORY.md（不存在则返回空） */
  async load(): Promise<void>;

  /** 保存所有记忆到 MEMORY.md */
  async save(): Promise<void>;

  /** 添加一条记忆 */
  async add(tag: MemoryTag, content: string): Promise<MemoryEntry>;

  /** 删除一条记忆 */
  async remove(id: string): Promise<boolean>;

  /** 获取所有记忆 */
  getAll(): MemoryEntry[];

  /** 按标签筛选 */
  getByTag(tag: MemoryTag): MemoryEntry[];

  /** 获取格式化的记忆文本（用于注入系统提示词） */
  getFormatted(): string;

  /** 生成下一个可用 ID */
  private nextId(tag: MemoryTag): string;

  /** 解析 MEMORY.md 内容 */
  private parse(content: string): MemoryEntry[];

  /** 序列化为 MEMORY.md 格式 */
  private serialize(): string;
}
```

#### 4.2.3 `src/session/context-builder.ts` — 集成记忆管理

改造 `build()` 方法，在加载 MEMORY.md 后同时从 MemoryManager 获取结构化记忆：

```typescript
async build(tools: ToolRegistry, sessionMeta?: SessionMeta, query?: string): Promise<string> {
  // ... 原有逻辑 ...

  // v3.2: 如果有 MemoryManager 且有用户查询，获取相关记忆
  let memoryContent: string | null = null;
  if (this.memoryManager) {
    await this.memoryManager.load();
    const queryForMemory = query || sessionMeta?.title || '';
    // 如果有搜索引擎，搜索相关记忆；否则用全部记忆
    if (this.searchEngine && queryForMemory) {
      const allMemory = this.memoryManager.getAll();
      const relevantIds = await this.searchEngine.searchMemory(queryForMemory, allMemory, 5);
      const relevant = this.memoryManager.getAll().filter(m => relevantIds.includes(m.id));
      memoryContent = relevant.map(e => `- [${e.id}] ${e.content}`).join('\n');
    } else {
      memoryContent = this.memoryManager.getFormatted();
    }
  }

  // ... 注入模板 ...
}
```

#### 4.2.4 测试：`src/tests/test-memory-manager.ts`

| 测试用例 | 说明 |
|----------|------|
| 初始加载（无文件） | 返回空记忆列表 |
| 添加记忆 → 写入文件 | 持久化验证 |
| 添加多条 → 按 tag 筛选 | 分类正确 |
| 删除记忆 | 文件同步更新 |
| ID 自增 | P001 → P002 → P003 |
| getFormatted 输出格式 | Markdown 格式正确 |
| 重复加载不丢失数据 | load + save 幂等 |
| 空内容容错 | 损坏的 MEMORY.md 不崩溃 |

---

### v3.3.0：全文搜索引擎

**目标**：纯 JS 实现 BM25 算法，支持跨会话、跨模块的全文检索。

#### 4.3.1 BM25 算法说明

BM25 是信息检索领域最经典的排序算法，公式：

```
score(D, Q) = Σ IDF(qi) × (f(qi, D) × (k1 + 1)) / (f(qi, D) + k1 × (1 - b + b × |D| / avgdl))
```

其中：
- `f(qi, D)` — 词 qi 在文档 D 中的出现频率
- `|D|` — 文档 D 的长度
- `avgdl` — 所有文档的平均长度
- `k1` — 词频饱和参数（默认 1.5）
- `b` — 文档长度归一化参数（默认 0.75）
- `IDF(qi)` — 逆文档频率

#### 4.3.2 `src/session/search-engine.ts` — 搜索引擎

```typescript
/**
 * src/session/search-engine.ts
 *
 * 全文搜索引擎 —— 纯 JS BM25 实现。
 *
 * 功能：
 * - 构建倒排索引
 * - BM25 相关性排序
 * - 跨模块搜索（会话消息、工具结果、记忆条目）
 * - 索引持久化（JSON 格式）
 *
 * 不引入 SQLite / better-sqlite3 等原生依赖。
 *
 * v3.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** 索引文档 */
export interface SearchDocument {
  /** 文档唯一 ID */
  id: string;
  /** 文档来源 */
  source: 'session' | 'memory' | 'tool_result';
  /** 文档文本内容 */
  content: string;
  /** 关联的会话 ID（如果有） */
  sessionId?: string;
  /** 时间戳 */
  timestamp: string;
}

/** 搜索结果 */
export interface SearchResult {
  /** 文档 ID */
  id: string;
  /** BM25 相关性得分 */
  score: number;
  /** 匹配的片段（高亮） */
  snippet: string;
  /** 文档来源 */
  source: SearchDocument['source'];
}

/** 搜索引擎配置 */
export interface SearchEngineConfig {
  /** 索引存储目录，默认 ~/.firmclaw/index */
  indexDir?: string;
  /** BM25 k1 参数（默认 1.5） */
  k1?: number;
  /** BM25 b 参数（默认 0.75） */
  b?: number;
  /** 搜索结果最大数量（默认 10） */
  maxResults?: number;
  /** 分词器类型 */
  tokenizer?: 'simple' | 'bigram';
}

/** 倒排索引结构 */
interface InvertedIndex {
  /** 词 → 文档 ID → 词频 */
  postings: Record<string, Record<string, number>>;
  /** 文档 ID → 文档长度 */
  docLengths: Record<string, number>;
  /** 总文档数 */
  docCount: number;
  /** 所有文档的平均长度 */
  avgDocLength: number;
}

export class SearchEngine {
  private config: Required<SearchEngineConfig>;
  private index: InvertedIndex;
  private documents: Map<string, SearchDocument>;

  constructor(config?: SearchEngineConfig);

  /**
   * 添加文档到索引
   */
  addDocument(doc: SearchDocument): void;

  /**
   * 批量添加文档
   */
  addDocuments(docs: SearchDocument[]): void;

  /**
   * 删除文档
   */
  removeDocument(id: string): boolean;

  /**
   * 执行搜索
   *
   * @param query - 搜索关键词
   * @param limit - 最大结果数（可选，覆盖配置）
   * @returns 按相关性排序的搜索结果
   */
  search(query: string, limit?: number): SearchResult[];

  /**
   * 搜索记忆条目（便捷方法）
   */
  searchMemory(query: string, entries: MemoryEntry[], limit?: number): string[];

  /**
   * 持久化索引到磁盘
   */
  async persist(): Promise<void>;

  /**
   * 从磁盘加载索引
   */
  async load(): Promise<void>;

  /**
   * 清空索引
   */
  clear(): void;

  /** 分词（支持中英文混合） */
  private tokenize(text: string): string[];

  /** 计算 IDF */
  private idf(term: string): number;

  /** 提取匹配片段 */
  private extractSnippet(content: string, query: string): string;
}
```

#### 4.3.3 分词策略

```typescript
tokenize(text: string): string[] {
  // 1. 转小写
  text = text.toLowerCase();

  // 2. 提取中文 bigram（每两个连续汉字作为一个词）
  const chineseBigrams: string[] = [];
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  if (chineseChars) {
    for (let i = 0; i < chineseChars.length - 1; i++) {
      chineseBigrams.push(chineseChars[i] + chineseChars[i + 1]);
    }
    // 单字也作为索引项（提高召回率）
    chineseBigrams.push(...chineseChars);
  }

  // 3. 提取英文单词（按空格和标点分割）
  const englishWords = text.match(/[a-z0-9]+/g) || [];

  // 4. 合并并去重
  return [...new Set([...chineseBigrams, ...englishWords])];
}
```

#### 4.3.4 `src/session/manager.ts` — 集成搜索引擎

在 `append()` 方法中，自动将消息添加到搜索索引：

```typescript
async append(messages: StoredMessage[]): Promise<void> {
  // ... 原有逻辑 ...

  // v3.3: 自动更新搜索索引
  if (this.searchEngine) {
    for (const msg of messages) {
      this.searchEngine.addDocument({
        id: `${this.currentSessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        source: 'session',
        content: msg.content,
        sessionId: this.currentSessionId!,
        timestamp: msg.timestamp,
      });
    }
  }
}
```

#### 4.3.5 测试：`src/tests/test-search-engine.ts`

| 测试用例 | 说明 |
|----------|------|
| 添加文档 → 搜索命中 | 基础搜索 |
| 多文档 → 相关性排序 | BM25 排序正确 |
| 中文搜索 | bigram 分词 |
| 英文搜索 | 单词分词 |
| 混合中英文搜索 | 中英混合内容 |
| 无结果 → 返回空数组 | 边界处理 |
| 删除文档 → 搜索不命中 | 索引更新 |
| 索引持久化 → 加载后搜索 | 磁盘读写 |
| 大量文档性能 | 1000 文档搜索 < 100ms |
| 空查询 → 返回空 | 边界 |

---

### v3.4.0：CLI 集成 + 全量整合

**目标**：将全部 Phase 4 模块集成到 CLI，提供记忆管理和搜索命令。

#### 4.4.1 CLI 命令设计

| 命令 | 说明 | 示例 |
|------|------|------|
| `/search <query>` | 全文搜索（跨会话、记忆、工具结果） | `> /search ReAct 架构` |
| `/remember <text>` | 保存一条记忆（自动分类标签） | `> /remember 用户喜欢暗色主题` |
| `/forget <id>` | 删除一条记忆 | `> /forget P001` |
| `/compact` | 手动触发上下文压缩 | `> /compact` |
| `/memory [tag]` | 查看记忆（可选按标签筛选） | `> /memory` / `> /memory preference` |
| `/index` | 显示搜索索引统计 | `> /index` |

#### 4.4.2 `src/index.ts` 改造

新增 Phase 4 组件初始化：

```typescript
// Phase 4: 初始化记忆和搜索系统
const memoryManager = new MemoryManager({ workDir });
await memoryManager.load();

const searchEngine = new SearchEngine({
  indexDir: path.join(os.homedir(), '.firmclaw', 'index'),
});
await searchEngine.load();

const summarizer = new Summarizer(llm, tools, tokenCounter, {
  summarizeThreshold: 80000,
  maxMessagesToSummarize: 50,
});

// 更新 contextBuilder 配置（传入 memoryManager + searchEngine）
contextBuilder.setMemoryManager(memoryManager);
contextBuilder.setSearchEngine(searchEngine);

// 更新 agent 配置
const agent = new AgentLoop(llm, tools, {
  systemPrompt: '',
  maxTurns: 10,
  workDir,
  sessionManager,
  contextBuilder,
  tokenCounter,
  trimConfig: { maxTokens: 128000, maxToolResultTokens: 500 },
  summarizer,                      // v3.1
  summarizerConfig: { summarizeThreshold: 80000 },
});
```

#### 4.4.3 ContextBuilder 扩展

```typescript
export class ContextBuilder {
  private memoryManager?: MemoryManager;    // v3.2
  private searchEngine?: SearchEngine;      // v3.3

  /** 设置记忆管理器（v3.2） */
  setMemoryManager(manager: MemoryManager): void;

  /** 设置搜索引擎（v3.3） */
  setSearchEngine(engine: SearchEngine): void;

  /** 构建系统提示词（扩展签名，支持 query 参数） */
  async build(tools: ToolRegistry, sessionMeta?: SessionMeta, query?: string): Promise<string>;
}
```

---

## 五、依赖变更

Phase 4 **不引入新的外部依赖**。

所有新增功能均使用 Node.js 内置模块实现：
- 摘要压缩：复用已有 `LLMClient`
- 记忆管理：`fs` 读写 MEMORY.md
- 全文搜索：纯 JS BM25，倒排索引存储在内存 + JSON 文件

与项目计划中提到的 SQLite FTS5 / sqlite-vec 方案不同，Phase 4 选择纯 JS 实现以保持零原生依赖。如果未来需要更强的搜索能力（如语义搜索），可作为 Phase 6 的扩展引入 `better-sqlite3` + `sqlite-vec`。

---

## 六、目录结构变更（完整 v3.4.0）

```
src/
├── agent/
│   ├── agent-loop.ts      ← v3.1: 集成 Summarizer
│   └── types.ts           ← v3.1: AgentConfig 新增 summarizer
├── llm/
│   └── client.ts          ← 不变
├── session/
│   ├── types.ts           ← 不变
│   ├── store.ts           ← 不变
│   ├── manager.ts         ← v3.3: append 时更新搜索索引
│   ├── context-builder.ts ← v3.2: 集成 MemoryManager + SearchEngine
│   ├── summarizer.ts      ← v3.1: 新增（LLM 摘要压缩）
│   ├── memory-manager.ts  ← v3.2: 新增（记忆管理）
│   └── search-engine.ts   ← v3.3: 新增（BM25 全文搜索）
├── tools/
│   ├── types.ts           ← 不变
│   ├── context.ts         ← 不变
│   ├── registry.ts        ← 不变
│   ├── permissions.ts     ← 不变
│   ├── bash.ts            ← 不变
│   ├── read.ts            ← 不变
│   ├── write.ts           ← 不变
│   └── edit.ts            ← 不变
├── utils/
│   ├── event-stream.ts    ← v3.1: 新增 summary_generated / memory_saved 事件
│   ├── token-counter.ts   ← 不变
│   └── prompt-template.ts ← 不变
├── tests/
│   ├── test-bash.ts       ← [v1.0] Phase 1
│   ├── test-llm.ts        ← [v1.0] Phase 1
│   ├── test-agent.ts      ← [v1.0] Phase 1
│   ├── test-read.ts       ← [v1.2] Phase 2
│   ├── test-write.ts      ← [v1.3] Phase 2
│   ├── test-edit.ts       ← [v1.4] Phase 2
│   ├── test-bash-v2.ts    ← [v1.5] Phase 2
│   ├── test-permissions.ts ← [v1.6] Phase 2
│   ├── test-session-store.ts    ← [v2.1] Phase 3
│   ├── test-session-manager.ts  ← [v2.1] Phase 3
│   ├── test-context-builder.ts  ← [v2.2] Phase 3
│   ├── test-token-counter.ts    ← [v2.3] Phase 3
│   ├── test-summarizer.ts       ← [v3.1] Phase 4 (新增)
│   ├── test-memory-manager.ts   ← [v3.2] Phase 4 (新增)
│   └── test-search-engine.ts    ← [v3.3] Phase 4 (新增)
└── index.ts               ← v3.4: 集成全部 Phase 4 模块
```

---

## 七、安全考量

| 风险 | 缓解措施 |
|------|----------|
| 摘要 prompt 注入（用户消息包含恶意内容） | 摘要 prompt 使用固定模板，用户消息仅作为输入数据；LLM 输出不直接执行 |
| 记忆文件被恶意篡改 | MEMORY.md 由 MemoryManager 管理，写入时校验格式；异常行自动跳过 |
| 搜索索引损坏 | `load()` 时 try-catch 损坏文件，损坏时从空索引重建 |
| 搜索结果泄露敏感信息 | 搜索仅在本地执行，不发送到外部服务 |
| 大量文档导致内存占用 | 索引使用稀疏结构（倒排索引），仅存储出现的词项；支持 `clear()` 释放内存 |

---

## 八、验证标准

Phase 4 完成后，以下场景必须工作：

```bash
# 1. 长对话自动摘要
> （连续对话 60 轮，触发摘要）
[System] Summary generated: 50 messages compressed, 30000 → 2000 tokens

# 2. 摘要后仍能记住关键信息
> 之前我们讨论了什么技术方案？
我们讨论了使用 TypeScript strict 模式和 ReAct 架构...
                           ← 摘要保留了关键决策！

# 3. 手动保存记忆
> /remember 用户偏好 pnpm 而非 npm
Memory saved: [P001] 用户偏好 pnpm 而非 npm

# 4. 跨会话搜索
> /new
New session created: ...
> /search ReAct
Found 3 results:
  [1] [session] FirmClaw 使用 ReAct 架构... (score: 8.5)
  [2] [memory] [K001] FirmClaw 使用 ReAct 架构... (score: 7.2)
  [3] [session] ReAct 循环的核心是思考→行动→观察... (score: 5.1)

# 5. 查看和管理记忆
> /memory
偏好:
  - [P001] 用户偏好 pnpm 而非 npm
技术决策:
  - [T001] 项目使用 TypeScript strict 模式

# 6. 手动触发压缩
> /compact
Context compressed: 95000 → 12000 tokens

# 7. 搜索索引统计
> /index
Index: 152 documents, 3 sources (session/memory/tool_result)
```

---

## 九、断点续开指南

如果会话中断，按以下步骤恢复：

1. 读取本文件：`docs/roadmap-phase4.md`
2. 查看 git log 确认当前进度：`git log --oneline`
3. 查看 git tags：`git tag -l "v3.*"`
4. 找到最新完成的版本号，继续下一个版本的实现
5. 每个版本完成后：写代码 → 跑测试 → git commit + tag → 询问用户

### 当前进度

| 版本 | 内容 | 状态 |
|------|------|------|
| v3.0.0 | 设计基线 + 测试文件整理 | ⏳ 待开发 |
| v3.1.0 | LLM 摘要压缩（Summarizer） | ⏳ 待开发 |
| v3.2.0 | 记忆管理系统（MemoryManager） | ⏳ 待开发 |
| v3.3.0 | 全文搜索引擎（BM25 SearchEngine） | ⏳ 待开发 |
| v3.4.0 | CLI 集成 + 全量整合 | ⏳ 待开发 |
