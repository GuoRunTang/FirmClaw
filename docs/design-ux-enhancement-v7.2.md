# FirmClaw v7.2 技术实践方案：UX 增强 + 交互历史 + 长对话记忆

> 版本：v7.2 设计文档  
> 日期：2026-04-03  
> 状态：方案设计阶段

---

## 目录

1. [问题分析](#1-问题分析)
2. [方案一：执行状态指示 & 发送按钮管理](#2-方案一执行状态指示--发送按钮管理)
3. [方案二：交互历史记录系统](#3-方案二交互历史记录系统)
4. [方案三：长对话记忆机制改进](#4-方案三长对话记忆机制改进)
5. [实现路线图](#5-实现路线图)
6. [风险评估](#6-风险评估)

---

## 1. 问题分析

### 1.1 当前存在的 4 个核心问题

| # | 问题 | 影响 | 严重程度 |
|---|------|------|----------|
| P1 | Web UI 无执行状态指示 | 用户无法判断 Agent 是否在运行、已完成还是出错 | 高 |
| P2 | 发送按钮在 Agent 忙时不禁用 | 用户可重复发送消息，第二条收到 `SERVER_BUSY` 错误，体验差 | 高 |
| P3 | 无交互历史记录 | 用户无法查看工具执行详情、LLM 输入/输出上下文，无法调试 | 中 |
| P4 | 长对话上下文管理不够完善 | 摘要压缩阈值固定 80000 tokens，无法自动分层，摘要后上下文质量不确定 | 中 |

### 1.2 现有架构中的相关代码

- **状态管理**：`ConnectionContext.busy`（`src/gateway/types.ts:120`）—— 后端已有，前端未利用
- **事件系统**：`EventStream`（`src/utils/event-stream.ts`）—— 14 种事件类型，覆盖完整的 Agent 生命周期
- **事件转发**：`forwardEvents()`（`src/gateway/server.ts:386`）—— 只在 `ctx.busy` 时转发，已具备推送能力
- **会话存储**：`SessionStore`（`src/session/store.ts`）—— JSONL 格式，append-only，已有完善的 CRUD
- **摘要压缩**：`Summarizer`（`src/session/summarizer.ts`）—— LLM 摘要 + 滑动窗口锚点
- **Token 裁剪**：`TokenCounter`（`src/utils/token-counter.ts`）—— 两步裁剪策略（截断 + 整体移除）

---

## 2. 方案一：执行状态指示 & 发送按钮管理 ✅ 已实现

### 2.1 设计目标

参考 Claude Code 的交互模式，实现 11 种细粒度状态指示：
- Agent 运行时显示明确的当前执行阶段（思考/分析/执行/压缩/裁剪/重试/审批/错误/最大轮次）
- 显示当前正在执行的工具名称
- 每种状态配有独立的图标、动画和文案
- 发送按钮在 Agent 忙时禁用（灰色 + loading 动画 + 文案变化）
- 输入框 placeholder 提示用户等待
- Agent 完成后自动恢复输入

### 2.2 新增事件类型

在 `EventStream` 中新增 `agent_status` 事件和 `AgentStatusType` 类型：

```typescript
// src/utils/event-stream.ts
export type AgentStatusType =
  | 'idle'                     // 空闲，等待用户输入
  | 'thinking'                 // 正在调用 LLM（首次或再次思考）
  | 'analyzing'                // 正在分析工具结果 / 规划下一步
  | 'tool_executing'           // 正在执行工具
  | 'tool_completed'           // 工具执行完成，准备继续
  | 'summarizing'              // 正在生成摘要压缩上下文
  | 'trimming'                 // 正在裁剪上下文
  | 'retrying'                 // API 错误后正在重试
  | 'approving'                // 等待人工审批
  | 'error'                    // 执行出错
  | 'max_turns';               // 达到最大循环轮次

export type AgentEventType =
  | // ... 原有事件类型
  | 'agent_status';            // v7.2: Agent 状态变更 { status, detail?, toolName? }
```
| 'agent_status'  // v7.2: Agent 状态变更 { status: 'idle' | 'thinking' | 'tool_executing' | 'summarizing' | 'error' }
```

**在 `EVENT_TO_NOTIFICATION_METHOD` 中新增映射**（`src/gateway/types.ts`）：

```typescript
agent_status: 'agent.status',
```

### 2.3 AgentLoop 中发射状态事件

在 `src/agent/agent-loop.ts` 的 `run()` 方法中，在关键节点发射 `agent_status` 事件：

```typescript
// 进入 ReAct 循环前
this.events.emit('agent_status', { status: 'thinking' });

// 工具执行时（已有的 tool_start 之前）
this.events.emit('agent_status', { status: 'tool_executing', toolName });

// 摘要生成前
this.events.emit('agent_status', { status: 'summarizing' });

// run() 返回前（无论成功还是错误）
this.events.emit('agent_status', { status: 'idle' });
```

### 2.4 Web UI 前端改造

#### 2.4.1 新增 Agent 状态指示器

在输入区域上方添加状态条：

```html
<!-- 输入区域上方 -->
<div class="agent-status" id="agentStatus" style="display:none;">
  <div class="status-spinner"></div>
  <span id="statusText"></span>
  <span id="statusTool" class="status-tool"></span>
</div>
```

**CSS 样式**：

```css
.agent-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  font-size: 13px;
  color: var(--text-secondary);
}

.status-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-tool {
  color: var(--text-link);
  font-family: monospace;
}
```

#### 2.4.2 发送按钮状态管理

新增前端全局变量和逻辑：

```javascript
let agentBusy = false;

function setAgentBusy(busy) {
  agentBusy = busy;
  var btn = document.getElementById('sendBtn');
  var input = document.getElementById('input');
  var statusEl = document.getElementById('agentStatus');
  
  if (busy) {
    btn.disabled = true;
    btn.textContent = t('working');  // I18N: '处理中...'
    btn.classList.add('busy');
    input.setAttribute('placeholder', t('waitHint'));  // I18N: 'Agent 正在处理，请等待...'
  } else {
    btn.disabled = !ws || ws.readyState !== WebSocket.OPEN;
    btn.textContent = t('send');
    btn.classList.remove('busy');
    input.setAttribute('placeholder', t('inputPlaceholder'));
  }
}

function updateAgentStatus(data) {
  var statusEl = document.getElementById('agentStatus');
  var textEl = document.getElementById('statusText');
  var toolEl = document.getElementById('statusTool');
  
  if (data.status === 'idle') {
    statusEl.style.display = 'none';
    setAgentBusy(false);
  } else {
    statusEl.style.display = 'flex';
    setAgentBusy(true);
    
    switch (data.status) {
      case 'thinking':
        textEl.textContent = t('statusThinking');  // '正在思考...'
        toolEl.textContent = '';
        break;
      case 'tool_executing':
        textEl.textContent = t('statusTool');  // '正在执行'
        toolEl.textContent = data.toolName ? data.toolName : '';
        break;
      case 'summarizing':
        textEl.textContent = t('statusSummarizing');  // '正在压缩上下文...'
        toolEl.textContent = '';
        break;
      case 'error':
        textEl.textContent = t('statusError');  // '执行出错'
        toolEl.textContent = '';
        break;
    }
  }
}
```

#### 2.4.3 通知处理

在 `handleMessage()` 的通知分支中新增：

```javascript
case 'agent.status':
  updateAgentStatus(msg.params);
  break;
```

#### 2.4.4 I18N 扩展

```javascript
zh: {
  working: '处理中...',
  waitHint: 'Agent 正在处理，请等待...',
  statusThinking: '正在思考...',
  statusTool: '正在执行',
  statusSummarizing: '正在压缩上下文...',
  statusError: '执行出错',
}
```

### 2.5 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/utils/event-stream.ts` | 修改 | 新增 `agent_status` 事件类型 |
| `src/gateway/types.ts` | 修改 | 新增事件映射 |
| `src/agent/agent-loop.ts` | 修改 | 在关键节点发射状态事件 |
| `src/gateway/web-ui.ts` | 修改 | 状态指示器 UI + 发送按钮管理 |

---

## 3. 方案二：交互历史记录系统

### 3.1 设计目标

- 记录每次 Agent 执行的完整流程：用户输入 → 系统提示词 → LLM 调用 → 工具执行 → 最终输出
- 用户可在 Web UI 中查看某个 Session 的详细执行日志
- 记录与 Session 绑定，Session 删除时同步删除
- 支持查看每轮对话发送给 LLM 的完整上下文（messages 数组）

### 3.2 数据模型

#### 3.2.1 新增类型定义

```typescript
// src/session/types.ts 新增

/** 单次 Agent 执行的完整记录 */
export interface RunRecord {
  /** 执行唯一 ID */
  runId: string;
  /** 所属 Session ID */
  sessionId: string;
  /** 用户输入消息 */
  userMessage: string;
  /** 执行开始时间（ISO 8601） */
  startedAt: string;
  /** 执行结束时间 */
  endedAt: string;
  /** 执行状态 */
  status: 'success' | 'error' | 'max_turns' | 'cancelled';
  /** 总循环轮次 */
  turns: number;
  /** 总工具调用次数 */
  toolCalls: number;
  /** ReAct 循环的每个步骤 */
  steps: RunStep[];
  /** 发送给 LLM 的最终上下文（最后一轮） */
  finalContext?: {
    systemPrompt: string;
    messageCount: number;
    totalTokens: number;
  };
}

/** 单个执行步骤 */
export interface RunStep {
  /** 步骤序号（1-based） */
  step: number;
  /** 步骤类型 */
  type: 'llm_call' | 'tool_start' | 'tool_end' | 'summary' | 'context_trim';
  /** 步骤开始时间 */
  timestamp: string;
  /** 步骤耗时（毫秒） */
  durationMs: number;
  /** LLM 调用详情 */
  llmCall?: {
    /** LLM 输入 token 数（估算） */
    inputTokens: number;
    /** LLM 输出的文本（截断） */
    outputPreview: string;
    /** 是否有工具调用 */
    hasToolCalls: boolean;
    /** 工具调用列表 */
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: string;
    }>;
  };
  /** 工具执行详情 */
  toolExecution?: {
    toolName: string;
    arguments: Record<string, unknown>;
    /** 工具返回结果（截断至 2000 字符） */
    result: string;
    isError: boolean;
  };
  /** 摘要详情 */
  summary?: {
    compressedCount: number;
    originalTokens: number;
    newTokens: number;
  };
  /** 上下文裁剪详情 */
  contextTrim?: {
    originalTokens: number;
    trimmedTokens: number;
    removedCount: number;
  };
}
```

### 3.3 存储设计

#### 3.3.1 存储格式

与现有 Session 存储保持一致，采用 JSONL 格式：

```
文件路径：~/.firmclaw/sessions/{sessionId}.runs.jsonl

#RUNS_META {"sessionId":"abc123","runCount":5}
{"runId":"run_001","sessionId":"abc123","userMessage":"帮我分析代码","startedAt":"...","endedAt":"...","status":"success","turns":3,"toolCalls":2,"steps":[...]}
{"runId":"run_002","sessionId":"abc123","userMessage":"继续优化","startedAt":"...","endedAt":"...","status":"success","turns":2,"toolCalls":1,"steps":[...]}
```

#### 3.3.2 RunStore 类

```typescript
// src/session/run-store.ts

export class RunStore {
  private storageDir: string;

  constructor(storageDir: string);

  /** 创建 runs 文件（session 创建时调用） */
  async create(sessionId: string): Promise<void>;

  /** 追加一条 RunRecord */
  async append(sessionId: string, record: RunRecord): Promise<void>;

  /** 读取指定 Session 的所有 RunRecord */
  async readAll(sessionId: string): Promise<RunRecord[]>;

  /** 读取指定 RunRecord（按 runId） */
  async read(sessionId: string, runId: string): Promise<RunRecord | null>;

  /** 删除 Session 的所有运行记录（Session 删除时调用） */
  async delete(sessionId: string): Promise<void>;

  /** 获取 RunRecord 数量 */
  async count(sessionId: string): Promise<number>;
}
```

### 3.4 RunLogger 类

```typescript
// src/session/run-logger.ts

export class RunLogger {
  private store: RunStore;
  private currentRun: RunRecord | null;
  private currentStep: RunStep | null;
  private stepStartTime: number;

  constructor(store: RunStore);

  /** 开始记录一次 Agent 执行 */
  startRun(sessionId: string, userMessage: string): void;

  /** 记录 LLM 调用步骤 */
  logLLMCall(inputTokens: number, outputPreview: string, hasToolCalls: boolean, toolCalls?: Array<{id:string;name:string;arguments:string}>): void;

  /** 记录工具执行步骤 */
  logToolStart(toolName: string, args: Record<string, unknown>): void;

  /** 记录工具执行完成 */
  logToolEnd(result: string, isError: boolean): void;

  /** 记录摘要步骤 */
  logSummary(compressedCount: number, originalTokens: number, newTokens: number): void;

  /** 记录上下文裁剪 */
  logContextTrim(originalTokens: number, trimmedTokens: number, removedCount: number): void;

  /** 结束记录 */
  endRun(status: RunRecord['status'], turns: number, toolCalls: number): Promise<void>;

  /** 获取当前 RunRecord（用于设置 finalContext） */
  getCurrentRun(): RunRecord | null;
}
```

### 3.5 集成到 AgentLoop

在 `src/agent/agent-loop.ts` 中注入 `RunLogger`（可选，与现有渐进增强模式一致）：

```typescript
// AgentConfig 新增
export interface AgentConfig {
  // ... 现有字段
  runLogger?: RunLogger;  // v7.2: 运行记录器
}
```

在 `run()` 方法的各关键点调用 RunLogger：

```typescript
async run(userMessage: string): Promise<AgentResult> {
  // 开始记录
  if (this.runLogger) {
    this.runLogger.startRun(
      this.sessionManager?.getCurrentSessionId() ?? '',
      userMessage,
    );
  }

  // ReAct 循环中...
  // LLM 调用后
  if (this.runLogger) {
    this.runLogger.logLLMCall(
      this.tokenCounter?.countMessages(allMessages) ?? 0,
      response.content.slice(0, 500),
      !!(response.tool_calls && response.tool_calls.length > 0),
      response.tool_calls?.map(tc => ({
        id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
      })),
    );
  }

  // 工具执行
  if (this.runLogger) this.runLogger.logToolStart(toolName, toolArgs);
  // ... 执行工具 ...
  if (this.runLogger) this.runLogger.logToolEnd(result.content, result.isError);

  // 返回前
  if (this.runLogger) {
    await this.runLogger.endRun('success', turns, totalToolCalls);
  }
}
```

### 3.6 Gateway 路由 & Web UI

#### 3.6.1 新增路由

```typescript
// session.runs — 获取指定 Session 的运行记录列表
this.router.register('session.runs', async (params) => {
  const sessionId = params.sessionId as string;
  const runLogger = this.runLogger;
  if (!runLogger) return { runs: [] };
  const runs = await runLogger.getStore().readAll(sessionId);
  return { runs };
});

// session.run_detail — 获取指定 RunRecord 的详细步骤
this.router.register('session.run_detail', async (params) => {
  const { sessionId, runId } = params as { sessionId: string; runId: string };
  const runLogger = this.runLogger;
  if (!runLogger) return null;
  const run = await runLogger.getStore().read(sessionId, runId);
  return run;
});
```

#### 3.6.2 Web UI 展示

在侧边面板中新增 "执行历史" Tab：

```html
<div class="panel-tab" data-tab="history" onclick="switchPanelTab('history')">执行历史</div>

<div class="panel-body" id="tab-history" style="display:none;">
  <div class="history-summary" id="historySummary">
    <!-- 总计信息：执行次数、成功率、平均轮次 -->
  </div>
  <div class="history-list" id="historyList">
    <!-- 每条 RunRecord 显示为一个折叠卡片 -->
  </div>
</div>
```

每条 RunRecord 的卡片样式（折叠/展开）：

```
┌──────────────────────────────────────────┐
│ #1  帮我分析代码             2026-04-03  │
│ ✓ 成功 · 3轮 · 2次工具调用 · 12.3s      │
├──────────────────────────────────────────┤
│ [展开后显示]                              │
│ Step 1: LLM 调用 (input: 2400 tokens)    │
│   → 2 tool_calls: read_file, bash       │
│ Step 2: 工具执行 read_file (0.8s)       │
│   → 结果: "import { FirmClaw }..."       │
│ Step 3: 工具执行 bash (1.2s)            │
│   → 结果: "npm test\n..."                │
│ Step 4: LLM 调用 (input: 3800 tokens)    │
│   → 最终回复                              │
│                                          │
│ [查看发送给 LLM 的上下文]                  │
└──────────────────────────────────────────┘
```

### 3.7 Session 删除时的级联清理

在 `SessionManager.deleteSession()` 中同步删除运行记录：

```typescript
async deleteSession(sessionId: string): Promise<void> {
  await this.store.delete(sessionId);
  if (this.runStore) {
    await this.runStore.delete(sessionId);
  }
  this.metaCache.delete(sessionId);
  if (this.currentSessionId === sessionId) {
    this.currentSessionId = null;
  }
}
```

### 3.8 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/session/types.ts` | 修改 | 新增 `RunRecord` / `RunStep` 类型 |
| `src/session/run-store.ts` | **新增** | RunRecord 的 JSONL 存储层 |
| `src/session/run-logger.ts` | **新增** | 运行记录器，采集 Agent 执行数据 |
| `src/agent/types.ts` | 修改 | `AgentConfig` 新增 `runLogger` |
| `src/agent/agent-loop.ts` | 修改 | 注入 RunLogger，在各关键点采集数据 |
| `src/gateway/server.ts` | 修改 | 新增 `session.runs` / `session.run_detail` 路由 |
| `src/gateway/web-ui.ts` | 修改 | 新增执行历史 Tab + 卡片式展示 |

---

## 4. 方案三：长对话记忆机制改进

### 4.1 当前问题分析

| 问题 | 现状 | 影响 |
|------|------|------|
| 摘要阈值固定 | 80000 tokens，不可按场景调整 | 短对话不会压缩，长对话可能已经丢失关键信息 |
| 摘要时机单一 | 只在 `run()` 开始时判断一次 | 如果一轮回合内产生大量工具输出，可能超出上下文窗口 |
| 无重要信息提取 | 摘要 prompt 是通用的 | 无法区分哪些信息对后续对话更重要 |
| 系统提示词占用大 | 每次都完整注入，不随对话进展裁剪 | 工具列表、SOUL.md 等固定内容占用了大量 token |

### 4.2 改进策略：三层记忆架构

```
┌─────────────────────────────────────────────┐
│              128K 上下文窗口                  │
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ 第一层：系统提示词（动态裁剪）            ││
│  │  - 核心指令（永不裁剪）                   ││
│  │  - 工具列表（按使用频率排序，只保留前N个）  ││
│  │  - SOUL.md（超过阈值时截断尾部）          ││
│  │  - 记忆（按相关性排序，只保留 top K）     ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ 第二层：对话摘要（滑动窗口）               ││
│  │  - [摘要] 历史对话的关键决策和结论        ││
│  │  - 最近 N 条消息（保留完整上下文）         ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ 第三层：当前回合（完整保留）               ││
│  │  - 用户消息 + assistant 回复 + 工具结果   ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### 4.3 改进一：动态系统提示词裁剪

在 `ContextBuilder.build()` 中新增系统提示词的 token 预算机制：

```typescript
// src/session/context-builder.ts

export class ContextBuilder {
  /** 系统提示词 token 预算（默认 8000 tokens） */
  private systemPromptBudget = 8000;

  setSystemPromptBudget(budget: number): void {
    this.systemPromptBudget = budget;
  }

  /**
   * v7.2: 智能系统提示词组装
   * 
   * 按 token 预算动态裁剪各段内容：
   * 1. 核心指令（最高优先级，永不裁剪）
   * 2. 工具列表（按使用频率排序，只保留高优先级工具）
   * 3. 会话信息（固定格式，占用很小）
   * 4. 记忆（按相关性分数排序，预算内尽可能多保留）
   * 5. SOUL.md / AGENTS.md（剩余预算内填充）
   */
  async buildSmart(
    tools: ToolRegistry,
    sessionMeta?: SessionMeta,
    query?: string,
    activeSkillName?: string,
    skillArgs?: string,
    usedTools?: string[],   // v7.2: 本 session 中已使用过的工具列表
  ): Promise<{ prompt: string; tokenCount: number }>;
}
```

**工具列表裁剪策略**：

```typescript
private buildToolsSectionSmart(tools: ToolRegistry, usedTools: string[], budget: number): string {
  const allTools = tools.getAll();
  
  // 按使用频率排序：已使用的工具排在前面
  const sorted = [...allTools].sort((a, b) => {
    const aUsed = usedTools.includes(a.name) ? 1 : 0;
    const bUsed = usedTools.includes(b.name) ? 1 : 0;
    return bUsed - aUsed;
  });
  
  // 在预算内尽可能多地包含工具
  let result = '';
  for (const tool of sorted) {
    const desc = this.formatToolDescription(tool);
    const cost = this.tokenCounter.countText(desc);
    if (this.tokenCounter.countText(result) + cost > budget) break;
    result += desc + '\n';
  }
  
  return result || `（仅显示 ${sorted.slice(0, 3).map(t => t.name).join(', ')} 等 ${allTools.length} 个工具，因 token 限制已精简描述）`;
}
```

### 4.4 改进二：智能摘要触发

在 `AgentLoop.run()` 中新增**回合内摘要检查**：

```typescript
// 在 ReAct 循环的每次迭代开始时
while (turns < this.config.maxTurns) {
  turns++;
  
  // ... 上下文裁剪 ...
  
  // v7.2: 回合内摘要检查（在工具结果加入后，token 可能暴增）
  if (this.tokenCounter && this.summarizer) {
    const currentTokens = this.tokenCounter.countMessages(allMessages);
    const safetyMargin = this.config.trimConfig?.maxTokens ?? 128000;
    
    if (currentTokens > safetyMargin * 0.8) {
      // 距离上限 80% 时触发摘要
      const summaryResult = await this.summarizer.summarize(
        allMessages.slice(1),  // 排除 system prompt
      );
      if (summaryResult.summarized) {
        allMessages = [allMessages[0], ...summaryResult.messages];
        this.events.emit('summary_generated', { ... });
      }
    }
  }
  
  // ... LLM 调用 ...
}
```

### 4.5 改进三：重要信息标记与保留

在摘要 prompt 中增强**信息优先级**感知：

```typescript
const SUMMARY_PROMPT_V2 = `你是一个对话摘要助手。请将以下对话历史压缩为一段简洁的摘要。

信息优先级（高 → 低）：
1. 【必须保留】用户的明确偏好和要求（如 "我不用 TypeScript"、"不要修改 xxx 文件"）
2. 【必须保留】已做的关键决策和结论（用 ✓ 标记）
3. 【必须保留】未完成的任务（用 ○ 标记）
4. 【建议保留】技术方案和实现细节
5. 【可以省略】中间的调试过程、错误信息、重复的工具调用

要求：
1. 高优先级信息不得遗漏
2. 使用简洁的条目化格式
3. 不超过 1500 字

对话历史：
{{messages}}

请输出摘要：`;
```

### 4.6 改进四：Tool Result 自适应截断

当前 `maxToolResultTokens` 全局固定，v7.2 改为**根据剩余上下文动态调整**：

```typescript
// src/utils/token-counter.ts

export class TokenCounter {
  /**
   * v7.2: 自适应工具结果截断
   * 
   * 根据当前上下文使用量和剩余预算，动态计算每条工具结果的最大长度。
   * 当上下文宽裕时保留更多信息，紧张时激进截断。
   */
  getAdaptiveToolResultLimit(
    allMessages: Message[],
    config?: TrimConfig,
  ): number {
    const maxTokens = config?.maxTokens ?? 128000;
    const maxToolTokens = config?.maxToolResultTokens ?? 500;
    const currentUsage = this.countMessages(allMessages);
    const usageRatio = currentUsage / maxTokens;
    
    // 使用率 < 50%: 使用配置值
    // 使用率 50-80%: 线性缩减到配置值的 50%
    // 使用率 > 80%: 线性缩减到配置值的 20%
    if (usageRatio < 0.5) return maxToolTokens;
    if (usageRatio < 0.8) {
      const factor = 1 - (usageRatio - 0.5) / 0.6;  // 1.0 → 0.0
      return Math.round(maxToolTokens * (0.5 + 0.5 * factor));
    }
    
    const factor = 1 - (usageRatio - 0.8) / 0.2;  // 1.0 → 0.0
    return Math.round(maxToolTokens * (0.2 + 0.3 * Math.max(0, factor)));
  }
}
```

### 4.7 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/session/context-builder.ts` | 修改 | 新增 `buildSmart()` 智能组装方法 |
| `src/session/summarizer.ts` | 修改 | 升级摘要 prompt 为 V2（信息优先级） |
| `src/agent/agent-loop.ts` | 修改 | 新增回合内摘要检查 + 自适应截断 |
| `src/utils/token-counter.ts` | 修改 | 新增 `getAdaptiveToolResultLimit()` |

---

## 5. 实现路线图

### Phase 1：执行状态 & 发送按钮（优先级：高，预计工时：2h）

1. `event-stream.ts` 新增 `agent_status` 事件
2. `agent-loop.ts` 在关键节点发射状态事件
3. `web-ui.ts` 新增状态指示器 UI + 发送按钮禁用逻辑
4. `types.ts` 新增事件映射

### Phase 2：交互历史记录（优先级：中，预计工时：4h）

1. 新增 `RunRecord` / `RunStep` 类型定义
2. 实现 `RunStore` 存储层
3. 实现 `RunLogger` 采集器
4. `AgentLoop` 注入 RunLogger
5. Gateway 新增路由
6. Web UI 新增执行历史 Tab

### Phase 3：长对话记忆改进（优先级：中，预计工时：3h）

1. `ContextBuilder.buildSmart()` 智能组装
2. `Summarizer` 升级摘要 prompt
3. `AgentLoop` 回合内摘要检查
4. `TokenCounter.getAdaptiveToolResultLimit()`

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| RunLogger 采集数据导致性能下降 | 低 | 中 | 采集逻辑只在内存中操作，磁盘写入在 `endRun()` 时批量执行（单次 `appendFile`） |
| 摘要 prompt V2 兼容性 | 低 | 低 | 保留原 prompt 作为 fallback，V2 失败时降级 |
| 自适应截断算法不够精确 | 中 | 低 | 基于 4字符≈1token 的粗略估算，保守策略优先保近期消息 |
| Web UI 状态指示器与现有 thinking bubble 冲突 | 低 | 中 | 两者互补：状态指示器在输入区域上方（全局状态），thinking bubble 在消息区域内（内容级别） |
| 运行记录文件过大 | 低 | 低 | 每 Session 的运行记录文件通常 < 1MB（单次 RunRecord ≈ 5KB），30 天 GC 自动清理 |
