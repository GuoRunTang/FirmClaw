# FirmClaw Phase 3 设计文档

> **状态**: 设计中
> **基于**: v2.0.0 (Phase 1 + Phase 2 完成)
> **目标版本**: v2.4.0
> **前置版本**: v2.0.0 → v2.1.0 → v2.2.0 → v2.3.0 → v2.4.0

---

## 一、Phase 3 目标

**让 FirmClaw 支持多轮对话**。

当前（v2.0）每次 `agent.run()` 都从零开始构建 messages 数组，会话结束后上下文全部丢失。Phase 3 将实现：

1. **会话持久化**：对话历史以 JSONL 格式存盘，重启不丢失
2. **上下文重建**：从 JSONL 恢复完整的 messages 数组
3. **系统提示词动态组装**：运行时注入工具定义、工作区文件（SOUL.md / AGENTS.md）、会话状态
4. **基础上下文窗口管理**：token 计数 + 按优先级裁剪，防止超出 LLM 上限

---

## 二、设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 会话存储格式 | **JSONL（append-only）** | 每行一条消息 JSON，天然支持追加写入，无需复杂序列化 |
| 会话文件路径 | **`~/.firmclaw/sessions/{sessionId}.jsonl`** | 集中管理，与项目目录解耦，支持跨项目复用会话 |
| sessionId 生成 | **nanoid（26 字符）** | 轻量、无外部依赖，比 UUID 短且 URL 安全 |
| 系统提示词组装 | **模板引擎（手写）** | 用 `{{变量}}` 占位符 + 上下文对象替换，不引入 Handlebars 等重型库 |
| 工作区文件 | **`{workDir}/.firmclaw/SOUL.md` 等** | 遵循 OpenClaw 惯例，点目录隐藏 |
| Token 计数 | **简单估算（4字符≈1token）** | 中文场景下tiktoken不准确，Phase 4 可升级为模型专用计数器 |
| 上下文裁剪策略 | **工具结果优先裁剪** | 保留 system + user + assistant 完整，仅压缩 tool 角色的大输出 |

---

## 三、模块架构

### 3.1 新增文件总览

```
src/
├── session/
│   ├── types.ts          ← [v2.1] 会话类型定义
│   ├── store.ts          ← [v2.1] JSONL 存储层（读写会话文件）
│   ├── manager.ts        ← [v2.1] 会话管理器（创建/恢复/列表/清理）
│   └── context-builder.ts ← [v2.2] 系统提示词组装器
├── tools/
│   └── context.ts        ← [v2.1] ToolContext 新增 sessionId
├── agent/
│   ├── types.ts          ← [v2.1] AgentConfig 新增 session 相关字段
│   └── agent-loop.ts     ← [v2.3] 集成会话管理和上下文窗口
├── utils/
│   ├── token-counter.ts  ← [v2.3] 简单 token 计数器
│   └── prompt-template.ts ← [v2.2] 简单模板引擎
├── tests/
│   ├── test-session-store.ts    ← [v2.1]
│   ├── test-session-manager.ts  ← [v2.1]
│   ├── test-context-builder.ts  ← [v2.2]
│   └── test-token-counter.ts    ← [v2.3]
```

### 3.2 修改文件

```
src/
├── tools/
│   └── context.ts        ← [v2.1] ToolContext 新增 sessionId
├── agent/
│   ├── types.ts          ← [v2.1] AgentConfig 新增会话配置
│   └── agent-loop.ts     ← [v2.3] 使用 SessionManager + ContextBuilder + TokenCounter
├── index.ts              ← [v2.4] 集成全部 Phase 3 模块 + CLI 交互升级
```

### 3.3 架构图

```
                        ┌─────────────────────────────────────┐
                        │              CLI (index.ts)          │
                        │  - /new    创建新会话                │
                        │  - /resume 恢复上次会话              │
                        │  - /sessions 列出所有会话            │
                        │  - /clear  清除上下文重新开始        │
                        └──────────────┬──────────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────────────┐
                        │           AgentLoop (改造)            │
                        │                                     │
                        │  run(userMessage) {                  │
                        │    ① contextBuilder.build()          │
                        │    ② sessionManager.append()         │
                        │    ③ tokenCounter.trim()             │
                        │    ④ LLM.chat(messages) ← ReAct循环  │
                        │    ⑤ sessionManager.append() ← 结果  │
                        │  }                                  │
                        └──┬────────┬────────┬────────┬───────┘
                           │        │        │        │
                  ┌────────┘        │        │        └────────┐
                  ▼                 ▼        ▼                  ▼
    ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
    │ ContextBuilder   │ │ Session  │ │  Token   │ │ 工作区文件    │
    │                  │ │ Manager  │ │ Counter  │ │              │
    │ - 加载模板       │ │          │ │          │ │ SOUL.md      │
    │ - 注入工具定义   │ │ - create │ │ - count  │ │ AGENTS.md    │
    │ - 注入会话信息   │ │ - resume │ │ - trim   │ │ MEMORY.md    │
    │ - 注入工作区文件 │ │ - append │ │          │ │              │
    └──────────────────┘ │ - list   │ └──────────┘ └──────────────┘
                         │ - gc     │
                         └────┬─────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ SessionStore     │
                    │                  │
                    │ - JSONL 读写     │
                    │ - append (追加)  │
                    │ - read (恢复)    │
                    └──────────────────┘
```

---

## 四、版本拆分与详细设计

### v2.1.0：会话存储与管理

**目标**：消息持久化到磁盘，支持创建/恢复/列举/清理会话。

#### 4.1.1 `src/session/types.ts` — 类型定义

```typescript
/**
 * src/session/types.ts
 *
 * 会话系统的类型定义。
 */

/** 会话元数据 */
export interface SessionMeta {
  /** 会话唯一 ID（nanoid 26 字符） */
  id: string;
  /** 会话创建时间（ISO 8601） */
  createdAt: string;
  /** 最后活跃时间 */
  updatedAt: string;
  /** 关联的工作目录 */
  workDir: string;
  /** 会话标题（用户第一条消息的前 50 字，自动生成） */
  title: string;
  /** 消息条数 */
  messageCount: number;
}

/** 存储的单条消息（JSONL 一行） */
export interface StoredMessage {
  /** 消息角色 */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 消息内容 */
  content: string;
  /** 工具调用 ID（仅 tool 角色） */
  tool_call_id?: string;
  /** 工具调用列表（仅 assistant 角色） */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** 时间戳 */
  timestamp: string;
}

/** 会话管理器配置 */
export interface SessionConfig {
  /** 会话存储根目录，默认 ~/.firmclaw/sessions */
  storageDir?: string;
  /** 是否启用会话持久化（默认 true，测试时可关闭） */
  enabled?: boolean;
}
```

#### 4.1.2 `src/session/store.ts` — JSONL 存储层

设计要点：
- **append-only**：新消息只追加到文件末尾，不修改历史行
- **线程安全**：每次写入用 `fs.appendFile`（原子追加）
- **懒加载**：`readMessages()` 时才读取文件，不在内存中缓存全量
- **首行元数据**：JSONL 文件第一行是 `SessionMeta` JSON（以 `#META ` 前缀区分）

文件格式示例：
```
#META {"id":"abc123","createdAt":"2026-03-28T10:00:00Z","title":"帮我分析代码"}
{"role":"user","content":"帮我分析 src/index.ts","timestamp":"2026-03-28T10:00:00Z"}
{"role":"assistant","content":"我来读取这个文件...","tool_calls":[...],"timestamp":"2026-03-28T10:00:01Z"}
{"role":"tool","content":"文件内容...","tool_call_id":"call_abc","timestamp":"2026-03-28T10:00:02Z"}
```

核心方法：
```typescript
export class SessionStore {
  constructor(storageDir: string)

  /** 创建新会话文件，写入 meta 行 */
  async create(meta: SessionMeta): Promise<void>

  /** 追加一条消息到会话文件 */
  async append(sessionId: string, message: StoredMessage): Promise<void>

  /** 批量追加（一轮循环的多条消息） */
  async appendBatch(sessionId: string, messages: StoredMessage[]): Promise<void>

  /** 读取会话的所有消息（跳过 #META 行） */
  async readMessages(sessionId: string): Promise<StoredMessage[]>

  /** 读取会话元数据（#META 行） */
  async readMeta(sessionId: string): Promise<SessionMeta | null>

  /** 更新元数据（覆写 #META 行） */
  async updateMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void>

  /** 列出所有会话的元数据 */
  async listAll(): Promise<SessionMeta[]>

  /** 删除会话文件 */
  async delete(sessionId: string): Promise<void>

  /** 会话文件路径 */
  private filePath(sessionId: string): string
}
```

#### 4.1.3 `src/session/manager.ts` — 会话管理器

设计要点：
- 封装 `SessionStore`，对外提供面向业务的 API
- 内部维护一个内存中的 `SessionMeta` 缓存（避免频繁读文件）
- 提供 `toLLMMessages()` 方法：`StoredMessage[]` → `Message[]`（去掉 timestamp 字段）

```typescript
export class SessionManager {
  private store: SessionStore;
  private currentSessionId: string | null;
  private metaCache: Map<string, SessionMeta>;

  constructor(config: SessionConfig)

  /** 创建新会话 */
  async create(workDir: string, firstMessage?: string): Promise<SessionMeta>

  /** 恢复已有会话 */
  async resume(sessionId: string): Promise<SessionMeta>

  /** 恢复最近一次会话（按 updatedAt 排序） */
  async resumeLatest(): Promise<SessionMeta | null>

  /** 向当前会话追加消息 */
  async append(messages: StoredMessage[]): Promise<void>

  /** 获取当前会话的完整 LLM 消息数组 */
  async getMessages(): Promise<Message[]>

  /** 列出所有会话 */
  async listSessions(): Promise<SessionMeta[]>

  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null

  /** 清理过期会话（超过 N 天） */
  async gc(maxAgeDays?: number): Promise<number>  // 返回清理数量
}
```

#### 4.1.4 `src/tools/context.ts` — ToolContext 扩展

```typescript
export interface ToolContext {
  workDir: string;
  sessionId?: string;       // Phase 3: 当前会话 ID
}
```

#### 4.1.5 `src/agent/types.ts` — AgentConfig 扩展

```typescript
export interface AgentConfig {
  systemPrompt: string;
  maxTurns: number;
  workDir?: string;
  // Phase 3 新增
  sessionEnabled?: boolean;   // 是否启用会话持久化
  sessionId?: string;         // 恢复指定会话
}
```

#### 4.1.6 测试：`src/tests/test-session-store.ts`

| 测试用例 | 说明 |
|----------|------|
| 创建会话 → 文件存在 | 基础创建 |
| append 单条 → 读取验证 | 追加 + 回读 |
| appendBatch → 顺序正确 | 批量追加 |
| readMessages → 跳过 #META | 解析正确 |
| listAll → 包含新创建的 | 列表功能 |
| delete → 文件消失 | 清理功能 |
| readMeta → 返回正确元数据 | 元数据读写 |

#### 4.1.7 测试：`src/tests/test-session-manager.ts`

| 测试用例 | 说明 |
|----------|------|
| create + append + getMessages → 数据完整 | 端到端 |
| resume 已有会话 → 能读到历史 | 恢复 |
| resumeLatest → 返回最新的 | 最近恢复 |
| listSessions → 按时间倒序 | 列表排序 |
| gc → 清理过期会话 | 垃圾回收 |

---

### v2.2.0：系统提示词动态组装

**目标**：告别硬编码 `SYSTEM_PROMPT`，改为运行时动态生成。

#### 4.2.1 `src/utils/prompt-template.ts` — 简单模板引擎

```typescript
/**
 * 简单的 {{变量}} 模板替换。
 * 
 * 支持：
 * - {{variable}}       → 简单替换
 * - {{variable|default}} → 带默认值
 * - {{#section}}...{{/section}} → 条件渲染（变量为 truthy 时才输出）
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string
```

为什么不引入 Handlebars/Mustache？
- 它们的功能（循环、嵌套 helper）我们不需要
- 增加依赖体积（Handlebars ~60KB）
- 手写 `{{}}` 替换只需 30 行代码，完全够用

#### 4.2.2 `src/session/context-builder.ts` — 系统提示词组装器

核心思路：

```
                    ┌──────────────────────────────┐
                    │      最终 system prompt       │
                    │                              │
                    │  [SOUL.md 内容]              │
                    │                              │
                    │  你是 FirmClaw AI 智能体...   │
                    │                              │
                    │  ## 可用工具                  │
                    │  - bash: ...                 │
                    │  - read_file: ...            │
                    │  ...                         │
                    │                              │
                    │  ## AGENTS.md 内容（如果有）  │
                    │                              │
                    │  ## 当前会话信息              │
                    │  - 会话 ID: abc123           │
                    │  - 创建时间: ...             │
                    │  - 消息数: 15                │
                    │  - 工作目录: /code/FirmClaw  │
                    │                              │
                    │  ## MEMORY.md 内容（如果有）  │
                    └──────────────────────────────┘
```

```typescript
export interface ContextBuilderConfig {
  /** 工作目录（加载 SOUL.md 等的位置） */
  workDir: string;
  /** .firmclaw 目录名（默认 .firmclaw） */
  configDirName?: string;
  /** 自定义模板路径（可选，覆盖内置模板） */
  customTemplate?: string;
}

export class ContextBuilder {
  constructor(config: ContextBuilderConfig)

  /**
   * 构建完整的系统提示词
   *
   * @param tools - 工具注册表（用于注入工具定义）
   * @param sessionMeta - 当前会话元数据（可选）
   */
  async build(tools: ToolRegistry, sessionMeta?: SessionMeta): Promise<string>

  /** 加载工作区文件（不存在则返回 null） */
  private async loadWorkspaceFile(fileName: string): Promise<string | null>

  /** 生成工具描述段 */
  private buildToolsSection(tools: ToolRegistry): string

  /** 生成会话信息段 */
  private buildSessionSection(meta: SessionMeta): string
}
```

工作区文件说明：

| 文件 | 路径 | 用途 | 是否必须 |
|------|------|------|----------|
| SOUL.md | `{workDir}/.firmclaw/SOUL.md` | 定义智能体的人格和行为准则 | 否（有默认） |
| AGENTS.md | `{workDir}/.firmclaw/AGENTS.md` | 定义子智能体或协作规则（Phase 6） | 否 |
| MEMORY.md | `{workDir}/.firmclaw/MEMORY.md` | 长期记忆笔记（Phase 4 自动管理） | 否 |

内置系统提示词模板：
```
{{#soul}}
{{soul}}

---
{{/soul}}
你是一个本地 AI 智能体助手，可以读取/写入/编辑文件和执行终端命令来帮助用户完成任务。

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
- 如果操作失败，分析错误原因并尝试其他方法
- 使用中文回复
- 回答要简洁直接
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
{{/memory}}
```

#### 4.2.3 测试：`src/tests/test-context-builder.ts`

| 测试用例 | 说明 |
|----------|------|
| 无工作区文件 → 使用默认模板 | 降级兼容 |
| 有 SOUL.md → 注入到顶部 | 自定义人格 |
| 有 AGENTS.md → 注入协作规则 | 协作配置 |
| 有 MEMORY.md → 注入记忆内容 | 记忆读取 |
| 有会话元数据 → 注入会话信息 | 会话感知 |
| 自定义模板路径 → 覆盖内置 | 可扩展 |
| 工具列表正确渲染 | 工具注入 |

---

### v2.3.0：上下文窗口管理 + AgentLoop 集成

**目标**：防止对话过长超出 LLM token 上限，并将会话管理和提示词组装集成到 AgentLoop。

#### 4.3.1 `src/utils/token-counter.ts` — Token 计数器

```typescript
/**
 * 简单的 token 估算器。
 *
 * 策略：4 个非 ASCII 字符 ≈ 1 token（中文场景）
 *       4 个 ASCII 字符 ≈ 3 token（英文场景）
 * 平均混合估算：约 4 字符 / token
 *
 * 这不是精确计数，但足以做裁剪判断。
 * Phase 4 可升级为 tiktoken（需安装 WASM 依赖）。
 */
export class TokenCounter {
  /** 估算单条消息的 token 数 */
  countMessage(message: Message): number

  /** 估算消息列表的总 token 数 */
  countMessages(messages: Message[]): number

  /** 估算纯文本的 token 数 */
  countText(text: string): number
}
```

计算规则：
```typescript
countText(text: string): number {
  // 简单估算：每 4 个字符 ≈ 1 token
  return Math.ceil(text.length / 4);
}
```

#### 4.3.2 上下文裁剪策略

```
                    messages 数组（发送给 LLM）
                    ┌───────────────────────────────┐
                    │ [0] system      ← 永不裁剪    │  优先级 1
                    │ [1] user #1     ← 永不裁剪    │  优先级 1
                    │ [2] assistant   ← 永不裁剪    │  优先级 1
                    │     tool_calls: [bash]        │
                    │ [3] tool (bash) ← 可裁剪      │  优先级 3
                    │     ↓ 截断到 500 token        │
                    │ [4] assistant   ← 保留        │  优先级 2
                    │ [5] tool (read) ← 可裁剪      │  优先级 3
                    │     ↓ 截断到 500 token        │
                    │ [6] assistant   ← 保留        │  优先级 2
                    │ [7] user #2     ← 永不裁剪    │  优先级 1
                    │ [8] assistant   ← 保留        │  优先级 2
                    └───────────────────────────────┘
```

裁剪规则：
1. **system 消息**：永不裁剪
2. **user 消息**：永不裁剪
3. **assistant 消息**：永不裁剪（保留推理链）
4. **tool 消息**：优先裁剪，超过 `maxToolResultTokens`（默认 500）时截断，并在末尾追加 `...(truncated)`
5. **整体裁剪**：如果总 token 仍超限，从最早的消息开始移除（但保留第一条 user 消息和 system 消息）

```typescript
export interface TrimConfig {
  /** 最大 token 数（对应 LLM 上下文窗口），默认 128000 */
  maxTokens?: number;
  /** 单条 tool 消息最大 token 数，默认 500 */
  maxToolResultTokens?: number;
  /** 是否在控制台输出裁剪统计 */
  verbose?: boolean;
}

export class TokenCounter {
  /**
   * 裁剪消息列表，确保不超过 token 上限
   *
   * @returns 裁剪后的消息数组 + 裁剪统计
   */
  trimMessages(messages: Message[], config?: TrimConfig): {
    messages: Message[];
    originalTokens: number;
    trimmedTokens: number;
    removedCount: number;
    truncatedCount: number;
  }
}
```

#### 4.3.3 `src/agent/agent-loop.ts` — 集成改造

改造后的 `run()` 方法流程：

```typescript
async run(userMessage: string): Promise<AgentResult> {
  // ──── Phase 3 新增 ────

  // ① 如果没有会话，自动创建
  if (!this.currentSessionId && this.sessionManager) {
    const meta = await this.sessionManager.create(this.config.workDir!, userMessage);
    this.currentSessionId = meta.id;
    this.events.emit('session_start', meta);
  }

  // ② 构建系统提示词（动态组装）
  const sessionMeta = await this.sessionManager?.getCurrentMeta();
  const systemPrompt = this.contextBuilder
    ? await this.contextBuilder.build(this.tools, sessionMeta ?? undefined)
    : this.config.systemPrompt;

  // ③ 恢复历史消息
  const historyMessages = this.sessionManager
    ? await this.sessionManager.getMessages()
    : [];

  // ④ 添加当前用户消息
  const allMessages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ];

  // ──── 原有 ReAct 循环（基本不变） ────

  while (turns < this.config.maxTurns) {
    turns++;

    // ⑤ 每轮循环前裁剪上下文
    if (this.tokenCounter) {
      const result = this.tokenCounter.trimMessages(allMessages, this.trimConfig);
      if (result.trimmedTokens < result.originalTokens) {
        allMessages = result.messages;
        this.events.emit('context_trimmed', result);
      }
    }

    const response = await this.llm.chat(allMessages, this.tools, (delta) => {
      this.events.emit('thinking_delta', delta);
    });

    allMessages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      // ⑥ 循环结束，保存消息到会话
      await this.persistMessages(userMessage, response);
      return { text: response.content, turns, toolCalls: totalToolCalls };
    }

    // 工具执行（与 v2.0 相同）
    for (const toolCall of response.tool_calls) {
      // ... 工具执行逻辑不变 ...
    }
  }

  // ⑦ 超过最大轮次，保存消息
  await this.persistMessages(userMessage, { role: 'assistant', content: warning });
  return { text: warning, turns, toolCalls: totalToolCalls };
}

/** 保存本轮对话消息到会话存储 */
private async persistMessages(userMessage: string, response: Message): Promise<void> {
  if (!this.sessionManager || !this.currentSessionId) return;

  const now = new Date().toISOString();
  await this.sessionManager.append([
    { role: 'user', content: userMessage, timestamp: now },
    { ...response, timestamp: now },
    // ... tool messages 也需要保存（如果有的话）
  ]);
}
```

**改造原则**：
- **不破坏现有接口**：`run(userMessage)` 签名不变，没有 session 时行为与 v2.0 完全一致
- **渐进增强**：`sessionManager` 和 `contextBuilder` 为可选，null 时走原逻辑
- **事件流扩展**：新增 `session_start`、`context_trimmed` 事件类型

#### 4.3.4 `src/utils/event-stream.ts` — 新增事件类型

```typescript
export type AgentEventType =
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_end'
  | 'message_end'
  | 'error'
  | 'session_start'      // Phase 3: 会话开始 { id, title, createdAt }
  | 'context_trimmed';   // Phase 3: 上下文被裁剪 { originalTokens, trimmedTokens }
```

#### 4.3.5 测试：`src/tests/test-token-counter.ts`

| 测试用例 | 说明 |
|----------|------|
| 纯中文 → 4字符≈1token | 中文估算 |
| 纯英文 → 4字符≈1token | 英文估算 |
| 工具消息超长 → 截断 | 单条截断 |
| 总 token 超限 → 从旧消息移除 | 整体裁剪 |
| system + 首条 user → 永不移除 | 保护规则 |
| 空 messages → 返回空 | 边界 |

---

### v2.4.0：CLI 交互升级 + 全量集成

**目标**：将全部 Phase 3 模块集成到 CLI，提供会话管理命令。

#### 4.4.1 CLI 命令设计

| 命令 | 说明 | 示例 |
|------|------|------|
| `/new` | 创建新会话 | `> /new` |
| `/resume [id]` | 恢复指定/最近会话 | `> /resume` |
| `/sessions` | 列出所有会话 | `> /sessions` |
| `/clear` | 清除当前上下文（但保留历史） | `> /clear` |
| `/session` | 显示当前会话信息 | `> /session` |
| `/soul` | 显示/编辑 SOUL.md | `> /soul` |
| `/memory` | 显示/编辑 MEMORY.md | `> /memory` |
| `/compact` | 手动触发上下文压缩 | `> /compact` |
| `/exit` | 退出 | `> /exit` |
| `普通文本` | 作为 user message 发送 | `> 帮我分析代码` |

#### 4.4.2 `src/index.ts` 改造

```typescript
async function main(): Promise<void> {
  // ... 配置加载不变 ...

  // ──── Phase 3: 初始化会话系统 ────
  const sessionManager = new SessionManager({
    storageDir: path.join(os.homedir(), '.firmclaw', 'sessions'),
  });

  const contextBuilder = new ContextBuilder({
    workDir,
  });

  const tokenCounter = new TokenCounter();

  const agent = new AgentLoop(llm, tools, {
    systemPrompt: '', // 不再使用，由 ContextBuilder 动态生成
    maxTurns: 10,
    workDir,
    sessionManager,    // Phase 3
    contextBuilder,    // Phase 3
    tokenCounter,      // Phase 3
    trimConfig: {
      maxTokens: 128000,
      maxToolResultTokens: 500,
    },
  });

  // ──── 启动时自动恢复上次会话 ────
  const latest = await sessionManager.resumeLatest();
  if (latest) {
    console.log(`Resumed session: ${latest.id} (${latest.title})`);
  }

  // ──── CLI 循环 ────
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = (): void => {
    rl.question('> ', async (input: string) => {
      const trimmed = input.trim();

      if (trimmed === '/exit' || trimmed === '/quit') { ... }

      // ──── 斜杠命令处理 ────
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed);
        prompt();
        return;
      }

      // ──── 普通消息 → agent.run() ────
      const result = await agent.run(trimmed);
      console.log(`\n--- [${result.turns} turns, ${result.toolCalls} tool calls] ---\n`);
      prompt();
    });
  };

  async function handleCommand(cmd: string) {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/new': {
        const meta = await sessionManager.create(workDir);
        agent.resetSession(meta.id);
        console.log(`New session created: ${meta.id}`);
        break;
      }
      case '/resume': {
        const id = parts[1];
        const meta = id
          ? await sessionManager.resume(id)
          : await sessionManager.resumeLatest();
        if (meta) {
          agent.resetSession(meta.id);
          console.log(`Resumed session: ${meta.id} (${meta.title})`);
        } else {
          console.log('No session found.');
        }
        break;
      }
      case '/sessions': {
        const sessions = await sessionManager.listSessions();
        sessions.forEach((s, i) => {
          console.log(`  [${i + 1}] ${s.id} | ${s.title} | ${s.messageCount} msgs | ${s.updatedAt}`);
        });
        break;
      }
      case '/session': {
        const id = agent.getCurrentSessionId();
        if (id) {
          const meta = await sessionManager.resume(id);
          console.log(JSON.stringify(meta, null, 2));
        } else {
          console.log('No active session.');
        }
        break;
      }
      case '/soul': {
        const soulPath = path.join(workDir, '.firmclaw', 'SOUL.md');
        if (fs.existsSync(soulPath)) {
          console.log(fs.readFileSync(soulPath, 'utf-8'));
        } else {
          console.log('No SOUL.md found. Create one at .firmclaw/SOUL.md');
        }
        break;
      }
      case '/memory': {
        const memPath = path.join(workDir, '.firmclaw', 'MEMORY.md');
        if (fs.existsSync(memPath)) {
          console.log(fs.readFileSync(memPath, 'utf-8'));
        } else {
          console.log('No MEMORY.md found.');
        }
        break;
      }
      default:
        console.log(`Unknown command: ${cmd}`);
        console.log('Available: /new, /resume, /sessions, /session, /soul, /memory, /exit');
    }
  }

  prompt();
}
```

#### 4.4.3 AgentLoop 接口扩展

```typescript
// src/agent/types.ts 新增

export interface AgentConfig {
  systemPrompt: string;
  maxTurns: number;
  workDir?: string;
  // Phase 3 新增
  sessionManager?: SessionManager;
  contextBuilder?: ContextBuilder;
  tokenCounter?: TokenCounter;
  trimConfig?: TrimConfig;
}

// src/agent/agent-loop.ts 新增方法

export class AgentLoop {
  // ... 原有代码 ...

  /** 切换到指定会话（下次 run 时使用新会话的历史） */
  resetSession(sessionId: string): void

  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null

  /** 获取会话管理器引用（供 CLI 使用） */
  getSessionManager(): SessionManager | null
}
```

---

## 五、依赖变更

Phase 3 **不引入新的外部依赖**。

所有新增功能使用 Node.js 内置模块（`fs`、`path`、`os`、`crypto`）实现：
- sessionId 使用 `crypto.randomUUID()`（Node.js 内置，无需 nanoid）
- JSONL 读写使用 `fs.appendFile` + `fs.readFile`（内置）
- 模板引擎手写（无外部依赖）

如果需要更短的 ID，Phase 4 可引入 nanoid（~130B）。

---

## 六、目录结构变更（完整 v2.4.0）

```
src/
├── agent/
│   ├── agent-loop.ts      ← v2.3: 集成 SessionManager + ContextBuilder
│   └── types.ts           ← v2.1: AgentConfig 扩展
├── llm/
│   └── client.ts          ← 不变
├── session/               ← 新增目录
│   ├── types.ts           ← v2.1: SessionMeta, StoredMessage, SessionConfig
│   ├── store.ts           ← v2.1: JSONL 读写（纯 Node.js fs）
│   ├── manager.ts         ← v2.1: 会话生命周期管理
│   └── context-builder.ts ← v2.2: 系统提示词组装
├── tools/
│   ├── types.ts           ← 不变
│   ├── context.ts         ← v2.1: 新增 sessionId
│   ├── registry.ts        ← 不变
│   ├── permissions.ts     ← 不变
│   ├── bash.ts            ← 不变
│   ├── read.ts            ← 不变
│   ├── write.ts           ← 不变
│   └── edit.ts            ← 不变
├── utils/
│   ├── event-stream.ts    ← v2.3: 新增 session_start / context_trimmed 事件
│   ├── token-counter.ts   ← v2.3: token 估算 + 消息裁剪
│   └── prompt-template.ts ← v2.2: {{}} 模板替换
├── tests/
│   ├── test-bash.ts       ← 不变
│   ├── test-llm.ts        ← 不变
│   ├── test-agent.ts      ← v2.3: 更新为支持 session 模式
│   ├── test-session-store.ts    ← v2.1: 新增
│   ├── test-session-manager.ts  ← v2.1: 新增
│   ├── test-context-builder.ts  ← v2.2: 新增
│   └── test-token-counter.ts    ← v2.3: 新增
└── index.ts               ← v2.4: CLI 集成全部 Phase 3 模块
```

---

## 七、安全考量

| 风险 | 缓解措施 |
|------|----------|
| 会话文件泄露敏感对话 | 存储在用户目录下，权限继承 OS 文件权限 |
| JSONL 文件损坏 | append-only 写入 + 首行 #META 校验 + 读取时 try-catch |
| 路径遍历（sessionId 作为文件名） | sessionId 仅允许 `[a-zA-Z0-9_-]`，由 `crypto.randomUUID()` 保证 |
| 模板注入（{{}} 语法） | 模板内容来自本地文件（SOUL.md），不受用户输入影响 |
| 内存占用（大对话历史） | `getMessages()` 每次从磁盘读取，不在内存中缓存全量 |

---

## 八、验证标准

Phase 3 完成后，以下场景必须工作：

```bash
# 1. 创建新会话
> /new
New session created: a1b2c3d4...

# 2. 多轮对话 —— 智能体能记住上下文
> 我叫小明
好的小明，有什么可以帮你的？

> 你还记得我叫什么吗？
你叫小明。有什么需要帮忙的吗？

# 3. 退出后恢复会话
> /exit
Bye!

# 重启程序
> npm run dev
Resumed session: a1b2c3d4... (我叫小明)

> 你知道我是谁吗？
你叫小明。              ← 仍然记得！

# 4. 列出历史会话
> /sessions
  [1] a1b2c3d4... | 我叫小明 | 3 msgs | 2026-03-28T10:00:00Z

# 5. 长对话不会崩溃
> （连续对话 50 轮）
Context trimmed: 128000 → 95000 tokens
```

---

## 九、断点续开指南

如果会话中断，按以下步骤恢复：

1. 读取本文件：`docs/roadmap-phase3.md`
2. 查看 git log 确认当前进度：`git log --oneline`
3. 查看 git tags：`git tag -l "v2.*"`
4. 找到最新完成的版本号，继续下一个版本的实现
5. 每个版本完成后：写代码 → 跑测试 → git commit + tag → 询问用户

### 当前进度

| 版本 | 内容 | 状态 |
|------|------|------|
| v2.1.0 | 会话存储（SessionStore + SessionManager） | ✅ 完成 |
| v2.2.0 | 系统提示词组装（ContextBuilder + PromptTemplate） | ✅ 完成 |
| v2.3.0 | 上下文窗口管理（TokenCounter）+ AgentLoop 集成 | ✅ 完成 |
| v2.4.0 | CLI 交互升级 + 全量集成 | ✅ 完成 |

**Phase 3 全部完成！**
