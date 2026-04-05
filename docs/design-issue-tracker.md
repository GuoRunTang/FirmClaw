# FirmClaw 会话问题追踪系统技术方案

> 版本: v1.1 | 日期: 2026-04-03 | 状态: 设计中

---

## 1. 需求背景

FirmClaw 可能部署在**离线内网环境**，会面临多种非标准场景：环境依赖缺失、Python 依赖问题、文件路径包含中文导致乱码、智能体交互逻辑异常等。当前这些问题**仅散落在 `~/.firmclaw/sessions/*.jsonl` 文件中**，缺乏结构化提取和统计分析能力。

本方案设计一个**会话问题追踪系统**（Session Issue Tracker），实现：

1. **自动检测**：从 JSONL 会话文件中扫描并提取所有问题事件
2. **分类存储**：按问题类型（环境、权限、API、工具、编码、上下文等）分类
3. **逐会话总结**：为每个 Session 生成独立的问题报告
4. **全局汇总**：跨所有 Session 的统计排名、趋势分析、升级建议
5. **时间与次数统计**：记录发生时间和按类型聚合次数

---

## 2. 设计目标

| 目标 | 说明 |
|------|------|
| **自动检测** | 从 Agent Loop 的工具执行流程中自动捕获错误/异常事件 |
| **分类存储** | 按问题类型（环境、权限、API、工具、上下文等）分类记录 |
| **时间统计** | 记录每次问题发生的精确时间戳 |
| **次数统计** | 按类型聚合统计问题发生次数 |
| **可追溯** | 关联会话 ID，可回溯到原始 JSONL 会话文件查看上下文 |
| **非侵入** | 通过 Hook 机制接入，不修改 Agent Loop 核心逻辑 |

---

## 3. 问题分类体系

基于对 `agent-loop.ts` 和 `registry.ts` 中错误场景的分析，定义以下分类：

### 3.1 一级分类

| 分类代码 | 分类名称 | 说明 |
|----------|----------|------|
| `ENV` | 环境问题 | Node.js 运行时错误、文件系统异常（ENOENT 等）、Node.js 版本不兼容 |
| `DEP` | 依赖问题 | Python 依赖缺失（pip）、npm/pip 在离线环境无法安装、系统工具缺失（git、python3） |
| `ENCODING` | 编码问题 | 文件路径含中文导致乱码、文件读写编码错误、终端输出乱码 |
| `API` | LLM API 问题 | API 调用失败、token 超限、上下文过长、重试失败、离线环境无法访问 API |
| `TOOL` | 工具执行问题 | 工具执行崩溃（catch 异常）、子进程启动失败、命令超时、命令返回非零退出码 |
| `PERM` | 权限问题 | 权限策略拒绝、命令黑名单拦截、敏感文件保护拦截 |
| `APPROVAL` | 审批问题 | 人工审批被拒绝、审批超时 |
| `PARAM` | 参数问题 | JSON 参数解析失败、参数校验失败、工具不存在 |
| `AGENT` | 智能体交互问题 | Agent 循环异常、重复执行相同操作、陷入死循环、子智能体通信失败 |
| `CONTEXT` | 上下文问题 | Token 裁剪、摘要压缩触发、达到最大轮次 |
| `HOOK` | 钩子问题 | Before Hook 拒绝执行（较少见） |

### 3.2 二级细分

| 分类代码 | 二级代码 | 触发场景 | 对应源码位置 |
|----------|----------|----------|-------------|
| `API` | `api_call_failed` | LLM API 首次调用失败 | `agent-loop.ts:257` |
| `API` | `api_retry_failed` | 裁剪上下文后重试仍失败 | `agent-loop.ts:280` |
| `API` | `api_context_retry` | 因 token/context 过长触发裁剪重试 | `agent-loop.ts:266` |
| `TOOL` | `tool_crashed` | 工具 execute() 抛出未捕获异常 | `agent-loop.ts:411` |
| `TOOL` | `tool_unknown` | LLM 调用了不存在的工具 | `agent-loop.ts:351` |
| `TOOL` | `tool_start_failed` | 子进程启动失败 | `bash.ts:93` |
| `TOOL` | `tool_timeout` | 命令执行超时被 kill | `bash.ts:80` |
| `TOOL` | `tool_nonzero_exit` | 命令返回非零退出码 | `bash.ts:128` |
| `PERM` | `perm_path_denied` | 文件路径不在白名单内 | `permissions.ts:128` |
| `PERM` | `perm_command_blocked` | bash 命令命中黑名单 | `permissions.ts:161` |
| `PERM` | `perm_protected_file` | 尝试写入受保护文件 | `permissions.ts:138` |
| `PERM` | `perm_registry_denied` | registry 权限检查拒绝 | `registry.ts:125` |
| `APPROVAL` | `approval_denied` | 用户主动拒绝审批 | `agent-loop.ts:375` |
| `APPROVAL` | `approval_timeout` | 审批等待超时 | `agent-loop.ts:376` |
| `PARAM` | `param_json_parse_failed` | 工具参数 JSON 解析失败 | `agent-loop.ts:334` |
| `PARAM` | `param_validation_failed` | Ajv 参数校验失败 | `registry.ts:101` |
| `CONTEXT` | `context_trimmed` | Token 裁剪触发 | `agent-loop.ts:231` |
| `CONTEXT` | `context_summarized` | 摘要压缩触发 | `agent-loop.ts:190` |
| `CONTEXT` | `context_max_turns` | 达到最大循环轮次 | `agent-loop.ts:427` |
| `HOOK` | `hook_denied` | Before Hook 拒绝执行 | `registry.ts:116` |
| `ENV` | `env_enoent` | 文件/目录不存在（ENOENT） | `store.ts:97` |
| `ENV` | `env_version_mismatch` | Node.js 版本不满足要求 | `package.json:28` |
| `ENV` | `env_runtime_error` | Node.js 运行时异常（非工具相关） | `index.ts:697` |
| `DEP` | `dep_node_missing` | npm 依赖未安装（Cannot find module） | 运行时 |
| `DEP` | `dep_python_missing` | Python 环境缺失或版本不匹配 | `bash.ts` 输出 |
| `DEP` | `dep_pip_install_failed` | pip install 在离线环境失败 | `bash.ts` 输出 |
| `DEP` | `dep_system_tool_missing` | 系统工具缺失（git、python3 等） | `bash.ts` 输出 |
| `ENCODING` | `enc_path_chinese` | 文件路径包含中文导致操作异常 | `bash.ts` / `read.ts` |
| `ENCODING` | `enc_output_garbled` | 终端输出乱码（非 UTF-8 编码） | `bash.ts` 输出 |
| `ENCODING` | `enc_file_read_error` | 文件读取时编码错误 | `read.ts` |
| `AGENT` | `agent_loop_stuck` | Agent 重复执行相同操作（死循环） | `agent-loop.ts:227` |
| `AGENT` | `agent_subagent_failed` | 子智能体执行失败或超时 | `subagent-manager.ts` |
| `AGENT` | `agent_wrong_tool` | Agent 反复调用错误的工具 | `agent-loop.ts:327` |
| `AGENT` | `agent_goal_drift` | Agent 偏离用户意图，执行无关操作 | （语义分析） |

---

## 4. 架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    AgentLoop                         │
│  (ReAct 循环: LLM → Tool → LLM → ...)              │
└────────┬──────────┬──────────┬──────────┬───────────┘
         │          │          │          │
    events.emit   events.emit events.emit events.emit
    ('error')     ('tool_end') ('context_  ('approval_
                  isError?     trimmed')  denied')
         │          │          │          │
         ▼          ▼          ▼          ▼
┌─────────────────────────────────────────────────────┐
│              IssueTracker (新增模块)                   │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ EventListener│  │ IssueClassifier│  │ IssueStore  │ │
│  │ (监听事件)   │→ │ (分类+去重)    │→ │ (内存聚合)   │ │
│  └─────────────┘  └──────────────┘  └──────┬──────┘ │
└─────────────────────────────────────────────┼───────┘
                                              │
                                              ▼
                                   ┌─────────────────┐
                                   │ ReportGenerator  │
                                   │ (生成 MD 报告)    │
                                   └────────┬────────┘
                                            │
                                            ▼
                                   ~/.firmclaw/issues/
                                   └── session-{id}.md
                                   └── summary.md
```

### 4.2 接入方式：复用现有 Hook 机制

**方案 A（推荐）：通过 `HookManager` 的 After Hook 接入**

`src/tools/registry.ts` 的 `execute()` 方法在工具执行后运行 `after hooks`（第 134 行），我们可以注册一个全局 after hook 来捕获所有工具执行结果。

```typescript
// 注册方式（在 index.ts 初始化时）
hookManager.registerAfter('*', async (ctx: HookContext) => {
  if (ctx.result?.isError) {
    issueTracker.record({
      sessionId: ctx.toolContext.sessionId,
      category: classifyIssue(ctx.toolName, ctx.result.content),
      toolName: ctx.toolName,
      args: ctx.args,
      error: ctx.result.content,
      timestamp: new Date().toISOString(),
    });
  }
});
```

**方案 B（补充）：通过 `EventStream` 事件监听接入**

`AgentLoop` 已经通过 `EventStream` 发射了丰富的状态事件。对于非工具类的错误（如 LLM API 失败、上下文裁剪、审批拒绝等），通过事件监听捕获：

```typescript
eventStream.on('error', (detail) => { /* API 错误等 */ });
eventStream.on('context_trimmed', (detail) => { /* 上下文裁剪 */ });
eventStream.on('approval_denied', (detail) => { /* 审批拒绝 */ });
eventStream.on('summary_generated', (detail) => { /* 摘要压缩 */ });
```

**最终采用 A + B 双通道方案**，确保覆盖所有问题场景。

---

## 5. 数据结构

### 5.1 问题记录（IssueRecord）

```typescript
// src/issues/types.ts

/** 问题严重程度 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/** 单条问题记录 */
export interface IssueRecord {
  /** 唯一 ID */
  id: string;
  /** 一级分类代码 */
  category: IssueCategory;
  /** 二级细分代码 */
  subCategory: IssueSubCategory;
  /** 严重程度 */
  severity: IssueSeverity;
  /** 关联的会话 ID */
  sessionId: string;
  /** 会话标题（用于报告可读性） */
  sessionTitle?: string;
  /** 触发问题的工具名称（如适用） */
  toolName?: string;
  /** 工具参数摘要（脱敏后） */
  argsSummary?: string;
  /** 错误/问题描述 */
  description: string;
  /** 发生时间（ISO 8601） */
  timestamp: string;
  /** 是否已解决（LLM 在后续轮次成功处理） */
  resolved?: boolean;
}

/** 问题分类枚举 */
export type IssueCategory =
  | 'ENV' | 'DEP' | 'ENCODING' | 'API' | 'TOOL' | 'PERM'
  | 'APPROVAL' | 'PARAM' | 'AGENT' | 'CONTEXT' | 'HOOK';

export type IssueSubCategory = string; // 如 'tool_crashed', 'api_call_failed' 等
```

### 5.2 统计摘要（IssueSummary）

```typescript
/** 按类型聚合的统计 */
export interface CategoryStats {
  category: IssueCategory;
  label: string;        // 如 "工具执行问题"
  count: number;
  subCategories: Array<{
    subCategory: IssueSubCategory;
    label: string;
    count: number;
    firstSeen: string;  // ISO 8601
    lastSeen: string;   // ISO 8601
  }>;
}

/** 整体摘要 */
export interface IssueSummary {
  /** 统计时间范围 */
  from: string;
  to: string;
  /** 总问题数 */
  totalIssues: number;
  /** 按严重程度统计 */
  bySeverity: Record<IssueSeverity, number>;
  /** 按分类统计 */
  byCategory: CategoryStats[];
  /** 按会话统计（top N 问题最多的会话） */
  bySession: Array<{
    sessionId: string;
    sessionTitle: string;
    issueCount: number;
  }>;
  /** 解决率 */
  resolveRate: number; // resolved / total
}
```

---

## 6. 核心模块设计

### 6.1 模块清单

| 文件路径 | 职责 |
|----------|------|
| `src/issues/types.ts` | 类型定义（IssueRecord, IssueSummary 等） |
| `src/issues/tracker.ts` | 核心追踪器（事件监听 + 问题记录 + 聚合） |
| `src/issues/classifier.ts` | 问题分类器（根据错误文本自动分类） |
| `src/issues/store.ts` | 问题存储（内存聚合 + 可选 JSONL 持久化） |
| `src/issues/report-generator.ts` | Markdown 报告生成器 |

### 6.2 IssueTracker 核心类

```typescript
// src/issues/tracker.ts

export class IssueTracker {
  private store: IssueStore;
  private classifier: IssueClassifier;
  private reportGenerator: ReportGenerator;
  private enabled: boolean;

  constructor(config?: IssueTrackerConfig);

  /** 绑定到 EventStream（方案 B 通道） */
  bindEvents(events: EventStream): void;

  /** 记录一条问题 */
  record(issue: Omit<IssueRecord, 'id'>): void;

  /** 标记问题已解决（LLM 在后续轮次成功处理） */
  resolve(issueId: string): void;

  /** 获取聚合统计 */
  getSummary(from?: string, to?: string): IssueSummary;

  /** 生成会话级报告（单次对话的问题汇总） */
  generateSessionReport(sessionId: string): string; // 返回 MD 内容

  /** 生成全局汇总报告 */
  generateGlobalSummary(): string; // 返回 MD 内容

  /** 将报告写入磁盘 */
  saveReport(sessionId: string): Promise<string>; // 返回文件路径
  saveGlobalSummary(): Promise<string>;
}
```

### 6.3 IssueClassifier 分类逻辑

分类器根据**错误消息文本模式**自动判断问题类别：

```typescript
// src/issues/classifier.ts

/** 分类规则表（按优先级排列，先匹配先生效） */
const CLASSIFICATION_RULES: Array<{
  pattern: RegExp;
  category: IssueCategory;
  subCategory: IssueSubCategory;
  severity: IssueSeverity;
}> = [
  // API 问题
  { pattern: /LLM API retry also failed/, category: 'API', subCategory: 'api_retry_failed', severity: 'error' },
  { pattern: /LLM API error.*token|context|too large|max|limit/i, category: 'API', subCategory: 'api_context_retry', severity: 'error' },
  { pattern: /LLM API error/i, category: 'API', subCategory: 'api_call_failed', severity: 'error' },

  // 工具问题
  { pattern: /Tool "(\w+)" crashed:/, category: 'TOOL', subCategory: 'tool_crashed', severity: 'error' },
  { pattern: /Failed to start command:/, category: 'TOOL', subCategory: 'tool_start_failed', severity: 'error' },
  { pattern: /timed out after \d+s/, category: 'TOOL', subCategory: 'tool_timeout', severity: 'warning' },
  { pattern: /exited with code \d+/, category: 'TOOL', subCategory: 'tool_nonzero_exit', severity: 'warning' },
  { pattern: /Unknown tool:/, category: 'TOOL', subCategory: 'tool_unknown', severity: 'warning' },

  // 权限问题
  { pattern: /Permission denied:.*blacklist/i, category: 'PERM', subCategory: 'perm_command_blocked', severity: 'error' },
  { pattern: /Permission denied:.*protected file/i, category: 'PERM', subCategory: 'perm_protected_file', severity: 'error' },
  { pattern: /Permission denied:/i, category: 'PERM', subCategory: 'perm_registry_denied', severity: 'warning' },
  { pattern: /Access denied:/i, category: 'PERM', subCategory: 'perm_path_denied', severity: 'warning' },

  // 审批问题
  { pattern: /denied by user/i, category: 'APPROVAL', subCategory: 'approval_denied', severity: 'warning' },
  { pattern: /approval timed out/i, category: 'APPROVAL', subCategory: 'approval_timeout', severity: 'warning' },

  // 参数问题
  { pattern: /Invalid JSON arguments/i, category: 'PARAM', subCategory: 'param_json_parse_failed', severity: 'warning' },
  { pattern: /Parameter validation failed:/i, category: 'PARAM', subCategory: 'param_validation_failed', severity: 'warning' },

  // 上下文问题
  { pattern: /Reached max turns/i, category: 'CONTEXT', subCategory: 'context_max_turns', severity: 'info' },

  // 钩子问题
  { pattern: /Execution denied by hook/i, category: 'HOOK', subCategory: 'hook_denied', severity: 'warning' },

  // ── v1.1 新增：离线内网环境相关问题 ──

  // 依赖问题
  { pattern: /Cannot find module/i, category: 'DEP', subCategory: 'dep_node_missing', severity: 'error' },
  { pattern: /MODULE_NOT_FOUND/i, category: 'DEP', subCategory: 'dep_node_missing', severity: 'error' },
  { pattern: /python.*not found|python3.*not found|Python.*No such file/i, category: 'DEP', subCategory: 'dep_python_missing', severity: 'error' },
  { pattern: /pip.*Could not find|pip.*No matching distribution|pip.*error.*offline/i, category: 'DEP', subCategory: 'dep_pip_install_failed', severity: 'error' },
  { pattern: /npm.*ERR!.*network|npm.*ERR!.*ECONNREFUSED|npm.*offline/i, category: 'DEP', subCategory: 'dep_node_missing', severity: 'error' },
  { pattern: /command not found|is not recognized/i, category: 'DEP', subCategory: 'dep_system_tool_missing', severity: 'error' },
  { pattern: /'git' .* is not recognized/i, category: 'DEP', subCategory: 'dep_system_tool_missing', severity: 'error' },

  // 编码问题
  { pattern: /EBADF|EPERM|EACCES.*[\\x80-\\xff]|[\\u4e00-\\u9fff].*error/i, category: 'ENCODING', subCategory: 'enc_path_chinese', severity: 'warning' },
  { pattern: /EINVAL.*encoding|UTF-8|utf8|codec|decode/i, category: 'ENCODING', subCategory: 'enc_file_read_error', severity: 'warning' },
  { pattern: /garbled|乱码|mojibake/i, category: 'ENCODING', subCategory: 'enc_output_garbled', severity: 'warning' },
  { pattern: /buffer.*encoding|not a valid UTF-8/i, category: 'ENCODING', subCategory: 'enc_file_read_error', severity: 'warning' },

  // 环境问题（补充）
  { pattern: /ENOENT.*no such file|ENOENT.*not found/i, category: 'ENV', subCategory: 'env_enoent', severity: 'error' },
  { pattern: /Node\.js.*version|engine.*not compatible/i, category: 'ENV', subCategory: 'env_version_mismatch', severity: 'error' },

  // 智能体交互问题
  { pattern: /Reached max turns.*\d+\).*max turns/i, category: 'AGENT', subCategory: 'agent_loop_stuck', severity: 'warning' },
  { pattern: /subagent.*failed|subagent.*timeout/i, category: 'AGENT', subCategory: 'agent_subagent_failed', severity: 'error' },
];
```

---

## 7. 报告格式

### 7.1 会话级报告（每个会话一个文件）

文件路径：`~/.firmclaw/issues/session-{sessionId}.md`

```markdown
# 会话问题报告

> 会话: 帮我分析代码
> 会话 ID: 2ad1e2dc-82c3-4f4d-b13d-6339b494553a
> 生成时间: 2026-04-03T08:42:00.000Z

## 概览

| 指标 | 值 |
|------|-----|
| 总问题数 | 7 |
| 已解决 | 5 |
| 未解决 | 2 |
| 解决率 | 71.4% |

## 按分类统计

| 分类 | 数量 | 占比 |
|------|------|------|
| 工具执行问题 (TOOL) | 3 | 42.9% |
| LLM API 问题 (API) | 2 | 28.6% |
| 权限问题 (PERM) | 1 | 14.3% |
| 上下文问题 (CONTEXT) | 1 | 14.3% |

## 问题详情

### TOOL-001 | 工具执行崩溃 | `bash`
- **时间**: 2026-04-03T08:30:15.000Z
- **严重程度**: error
- **描述**: Tool "bash" crashed: EACCES: permission denied, mkdir '/tmp/test'
- **参数**: `{"command": "mkdir /tmp/test"}`
- **状态**: ✅ 已解决（第 4 轮 LLM 改用 sudo 重试成功）

### TOOL-002 | 命令超时 | `bash`
- **时间**: 2026-04-03T08:31:22.000Z
- **严重程度**: warning
- **描述**: [Command timed out after 30s] npm install ...
- **参数**: `{"command": "npm install"}`
- **状态**: ❌ 未解决

### API-001 | LLM API 调用失败
- **时间**: 2026-04-03T08:32:45.000Z
- **严重程度**: error
- **描述**: LLM API error: Request timeout after 60000ms
- **状态**: ✅ 已解决（自动重试成功）

### PERM-001 | 文件路径被拒绝
- **时间**: 2026-04-03T08:35:10.000Z
- **严重程度**: warning
- **描述**: Access denied: "/etc/passwd" is outside allowed directories
- **参数**: `{"path": "/etc/passwd"}`
- **状态**: ✅ 已解决（LLM 读取了工作目录内的替代文件）

### CONTEXT-001 | 达到最大轮次
- **时间**: 2026-04-03T08:40:00.000Z
- **严重程度**: info
- **描述**: [Reached max turns (25)]
- **状态**: ——

## 建议

1. **[TOOL] 工具执行崩溃 (3 次)**: `bash` 工具出现 3 次执行崩溃，建议检查工作目录的文件权限配置
2. **[API] LLM API 问题 (2 次)**: API 调用不稳定，建议增加重试次数或切换更稳定的 API 端点
3. **[PERM] 权限拒绝 (1 次)**: Agent 尝试访问系统目录，可考虑优化系统提示词明确边界
```

### 7.2 全局汇总报告

文件路径：`~/.firmclaw/issues/summary.md`

```markdown
# FirmClaw 问题追踪汇总

> 统计时间: 2026-04-01 ~ 2026-04-03
> 总会话数: 42
> 总问题数: 128

## 严重程度分布

| 严重程度 | 数量 | 占比 |
|----------|------|------|
| error | 35 | 27.3% |
| warning | 72 | 56.3% |
| info | 21 | 16.4% |

## 分类排名（Top 5）

| 排名 | 分类 | 数量 | 趋势 |
|------|------|------|------|
| 1 | 工具执行问题 (TOOL) | 48 | ↑ +5 |
| 2 | LLM API 问题 (API) | 30 | ↓ -3 |
| 3 | 权限问题 (PERM) | 22 | — |
| 4 | 参数问题 (PARAM) | 15 | ↑ +2 |
| 5 | 上下文问题 (CONTEXT) | 13 | — |

## 细分问题排行（Top 10）

| 细分 | 分类 | 次数 | 最近发生 |
|------|------|------|---------|
| tool_crashed | TOOL | 20 | 2026-04-03 |
| tool_timeout | TOOL | 15 | 2026-04-03 |
| api_call_failed | API | 18 | 2026-04-02 |
| perm_path_denied | PERM | 14 | 2026-04-03 |
| param_json_parse_failed | PARAM | 12 | 2026-04-03 |
| tool_nonzero_exit | TOOL | 8 | 2026-04-02 |
| api_context_retry | API | 8 | 2026-04-02 |
| approval_timeout | APPROVAL | 5 | 2026-04-01 |
| context_max_turns | CONTEXT | 7 | 2026-04-03 |
| perm_command_blocked | PERM | 4 | 2026-04-01 |

## 问题最多的会话 (Top 5)

| 会话标题 | 问题数 | 会话 ID |
|----------|--------|---------|
| 部署项目到生产环境 | 12 | abc123... |
| 重构数据库模块 | 9 | def456... |
| 调试 CI/CD 流水线 | 7 | ghi789... |
| 安装项目依赖 | 6 | jkl012... |
| 迁移到 TypeScript | 5 | mno345... |

## 解决率趋势

| 日期 | 总问题 | 已解决 | 解决率 |
|------|--------|--------|--------|
| 2026-04-01 | 45 | 38 | 84.4% |
| 2026-04-02 | 52 | 40 | 76.9% |
| 2026-04-03 | 31 | 18 | 58.1% |

## 升级建议

1. **[高优先级] 工具执行稳定性**: `tool_crashed` 是最高频问题 (20 次)，建议：
   - 在 `bash` 工具中增加更完善的错误捕获
   - 对常见命令添加预检查逻辑
   - 优化错误消息以便 LLM 更好地理解失败原因

2. **[中优先级] API 调用可靠性**: `api_call_failed` 18 次，建议：
   - 实现指数退避重试策略
   - 增加 API 健康检查和自动降级
   - 考虑多模型 fallback 机制

3. **[低优先级] 权限边界优化**: `perm_path_denied` 14 次，建议：
   - 优化系统提示词，减少 Agent 尝试越界访问
   - 增加路径提示，引导 Agent 使用正确的工作目录
```

---

## 8. 存储设计

### 8.1 目录结构

```
~/.firmclaw/
├── sessions/              # 现有：会话 JSONL 文件
│   └── {uuid}.jsonl
├── issues/                # 新增：问题追踪数据
│   ├── issues.jsonl       # 全量问题记录（append-only）
│   ├── session-{id}.md    # 会话级报告
│   └── summary.md         # 全局汇总报告
```

### 8.2 issues.jsonl 格式

```jsonl
{"id":"iss_001","category":"TOOL","subCategory":"tool_crashed","severity":"error","sessionId":"2ad1e2dc-...","sessionTitle":"帮我分析代码","toolName":"bash","argsSummary":"{\"command\":\"mkdir /tmp/test\"}","description":"Tool \"bash\" crashed: EACCES: permission denied","timestamp":"2026-04-03T08:30:15.000Z","resolved":true}
{"id":"iss_002","category":"API","subCategory":"api_call_failed","severity":"error","sessionId":"2ad1e2dc-...","sessionTitle":"帮我分析代码","description":"LLM API error: Request timeout after 60000ms","timestamp":"2026-04-03T08:32:45.000Z","resolved":true}
```

### 8.3 报告更新时机

| 时机 | 动作 |
|------|------|
| 每次 `run()` 结束（`message_end` 事件） | 更新当前会话的报告文件 |
| 程序退出时（`process.on('exit')`） | 更新全局汇总报告 |
| 用户显式请求（如 CLI 命令 `/issues`） | 实时生成并展示报告 |
| 定时任务（每 N 分钟） | 自动更新全局汇总 |

---

## 9. 与现有系统的集成点

### 9.1 集成位置（`src/index.ts`）

```typescript
// 在 FirmClaw 初始化流程中插入 IssueTracker

import { IssueTracker } from './issues/tracker.js';

// 1. 创建 IssueTracker 实例
const issueTracker = new IssueTracker({
  storageDir: path.join(os.homedir(), '.firmclaw', 'issues'),
  enabled: true,
});

// 2. 绑定 EventStream（方案 B 通道）
issueTracker.bindEvents(agentLoop.getEvents());

// 3. 注册 After Hook（方案 A 通道）
hookManager.registerAfter('*', async (ctx) => {
  if (ctx.result?.isError) {
    issueTracker.record({
      sessionId: ctx.toolContext.sessionId ?? 'unknown',
      sessionTitle: sessionManager?.getCurrentMeta()?.title,
      category: issueTracker.classify(ctx.result.content),
      toolName: ctx.toolName,
      argsSummary: sanitizeArgs(ctx.args),
      description: ctx.result.content,
      severity: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

// 4. 在 message_end 事件时生成会话报告
agentLoop.getEvents().on('message_end', () => {
  const sid = sessionManager?.getCurrentSessionId();
  if (sid) {
    issueTracker.saveReport(sid);
  }
});
```

### 9.2 对现有代码的修改量

| 文件 | 修改类型 | 修改量 |
|------|----------|--------|
| `src/index.ts` | 新增 IssueTracker 初始化和绑定 | ~20 行 |
| `src/agent/types.ts` | `AgentConfig` 可选增加 `issueTracker` 字段 | ~2 行 |
| `src/issues/*` | **新增** 5 个文件 | ~500 行（预估） |
| 现有核心逻辑 | **零修改** | 0 行 |

---

## 10. 实施计划

### Phase 1：核心框架（预估 2-3 小时）

- [ ] 创建 `src/issues/types.ts` —— 类型定义
- [ ] 创建 `src/issues/classifier.ts` —— 分类器
- [ ] 创建 `src/issues/store.ts` —— 内存存储 + JSONL 持久化
- [ ] 创建 `src/issues/tracker.ts` —— 核心追踪器（事件绑定 + 记录）

### Phase 2：报告生成（预估 1-2 小时）

- [ ] 创建 `src/issues/report-generator.ts` —— MD 报告模板
- [ ] 实现会话级报告生成
- [ ] 实现全局汇总报告生成

### Phase 3：集成与测试（预估 1-2 小时）

- [ ] 在 `src/index.ts` 中集成 IssueTracker
- [ ] 编写单元测试 `tests/test-issue-tracker.ts`
- [ ] 手动验证：触发各类错误场景，检查报告输出
- [ ] 补充分类规则覆盖边界情况

### Phase 4（可选增强）

- [ ] Web UI 中增加 `/issues` 面板展示问题报告
- [ ] 增加趋势分析（按天/周统计，识别问题增长趋势）
- [ ] 增加 LLM 自动建议（将汇总报告传给 LLM 生成升级建议）
- [ ] 增加问题去重（相同错误短时间多次触发只记录一次）

---

## 11. 设计决策说明

### Q1: 为什么用 Markdown 而不是 JSON/数据库？

- **可读性**：Markdown 可直接在 GitHub、IDE、Web UI 中渲染展示
- **可维护性**：开发者可以直接编辑和注释
- **轻量级**：不需要额外的数据库依赖
- **与项目文档风格一致**：FirmClaw 已有 `docs/` 目录使用 Markdown

### Q2: 为什么用 Hook + EventStream 双通道？

- `HookManager` (方案 A) 只能捕获**工具执行**的结果，无法覆盖 LLM API 错误、上下文裁剪等非工具场景
- `EventStream` (方案 B) 已有丰富的事件类型（`error`, `context_trimmed`, `approval_denied` 等），覆盖面广
- 双通道互补确保**零遗漏**

### Q3: 如何处理问题去重？

同一类错误在短时间内多次触发（如 LLM 连续 3 次超时），分类器会分别记录但报告生成时会**聚合展示**。如果需要严格去重，可在 Phase 4 中实现基于 `category + subCategory + toolName + 60s 时间窗口` 的去重策略。

### Q4: 性能影响？

- `IssueTracker.record()` 仅做内存写入（Map.push），不涉及 IO，延迟 < 0.1ms
- JSONL 持久化采用**批量追加**（随 `persistRound` 一起写入），不增加额外 IO
- 报告生成仅在 `message_end` 事件触发，不影响对话性能

---

## 12. 离线环境部署与打包指南

### 12.1 打包为全局命令

项目已配置 `bin` 字段（`package.json`）和 shebang（`src/index.ts`），可安装为全局命令。

#### 步骤 1：构建项目

```bash
cd d:\code\FirmClaw
npm run build
```

#### 步骤 2：全局链接（开发模式，推荐）

```bash
npm link
```

链接后在**任意目录**运行 `firmclaw` 即可启动：

```bash
cd D:\my-workspace
firmclaw
```

> `npm link` 会在全局 `node_modules` 中创建指向当前项目的符号链接，修改源码后重新 `npm run build` 即生效。

#### 步骤 3：全局安装（分发模式）

```bash
# 在项目目录执行
npm pack                    # 生成 firmclaw-7.0.0.tgz
npm install -g firmclaw-7.0.0.tgz   # 全局安装
```

> 此方式适合分发给其他机器，但目标机器需要 Node.js >= 18。

#### 步骤 4：离线内网部署

```bash
# 在有网络的机器上
pack-offline.bat            # 生成 offline-bundle.zip

# 拷贝到内网机器后
unzip offline-bundle.zip
copy .env.example .env      # 配置 LLM API（指向内网 LLM 端点）
npm install                 # 安装依赖
npm link                    # 注册全局命令（可选）
node dist/index.js          # 或直接运行
```

### 12.2 当前 CLI 命令现状

当前项目的命令体系如下：

| 层级 | 命令 | 当前状态 | 说明 |
|------|------|---------|------|
| REPL 内部 | `/help` | ✅ 可用 | 进入交互式 REPL 后使用 |
| REPL 内部 | `/serve [port]` | ✅ 可用 | 启动 WebSocket + Web UI 服务 |
| REPL 内部 | `/sessions` | ✅ 可用 | 列出所有会话 |
| REPL 内部 | `/new` | ✅ 可用 | 创建新会话 |
| REPL 内部 | `/compact` | ✅ 可用 | 手动触发上下文压缩 |
| CLI 级别 | `firmclaw --help` | ❌ 不支持 | 需要增加命令行参数解析 |
| CLI 级别 | `firmclaw dashboard` | ❌ 不支持 | 需要增加子命令路由 |
| CLI 级别 | `firmclaw issues` | ❌ 不支持 | 需要增加子命令路由 |

**当前行为**：运行 `firmclaw`（不带参数）直接进入交互式 REPL。带任何参数也会进入 REPL（参数被忽略）。

### 12.3 CLI 子命令增强方案（可选后续实现）

如需支持 `firmclaw --help`、`firmclaw dashboard` 等命令，建议改造入口文件：

```
firmclaw                    → 进入交互式 REPL（当前行为不变）
firmclaw --help             → 显示帮助信息
firmclaw --version          → 显示版本号
firmclaw serve [port]       → 直接启动 WebSocket 服务（不进入 REPL）
firmclaw issues             → 显示问题追踪汇总报告
firmclaw issues --session ID → 显示指定会话的问题报告
firmclaw issues --scan      → 扫描所有 JSONL 会话文件，重新生成报告
```

实现方式：在 `main()` 函数开头增加 `process.argv` 解析，不引入第三方依赖：

```typescript
// src/index.ts 顶部
const args = process.argv.slice(2);
const command = args[0];

if (command === '--help' || command === '-h') {
  console.log('Usage: firmclaw [command] [options]');
  console.log('  (no args)   Interactive REPL mode');
  console.log('  --help      Show help');
  console.log('  --version   Show version');
  console.log('  serve [port] Start WebSocket server');
  console.log('  issues      Show issue tracking report');
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log('firmclaw v7.0.0');
  process.exit(0);
}

if (command === 'serve') {
  // 直接启动 Gateway，不进入 REPL
  const port = parseInt(args[1]) || 3000;
  // ... 启动 GatewayServer
  process.exit(0);
}

if (command === 'issues') {
  // 生成并显示问题报告
  // ...
  process.exit(0);
}

// 无命令 → 进入 REPL（当前逻辑）
```

---

## 13. JSONL 会话离线分析方案

### 13.1 分析入口

问题追踪系统提供两种分析方式：

**方式 A：实时分析（在线模式）**

在 Agent 运行过程中，通过 Hook + EventStream 双通道实时捕获问题（第 4 章架构）。这是默认方式。

**方式 B：离线扫描（批量模式）**

对于已有的 JSONL 会话文件，提供 `scanSessions()` 方法批量扫描：

```typescript
// firmclaw issues --scan
const tracker = new IssueTracker({ storageDir: '...' });
await tracker.scanSessions();  // 遍历 ~/.firmclaw/sessions/*.jsonl
await tracker.saveGlobalSummary();
```

### 13.2 离线扫描逻辑

`scanSessions()` 的实现流程：

```
1. 列出 ~/.firmclaw/sessions/ 下所有 .jsonl 文件
2. 逐文件读取并解析：
   a. 第一行 #META → 提取 sessionId, title, createdAt
   b. 遍历后续行（StoredMessage）：
      - role='tool' 且 content 包含 Error/isError 关键词 → 触发分类器
      - role='tool' 且 content 包含乱码/编码相关关键词 → 触发编码分类
      - role='tool' 且 content 包含 dep 相关关键词 → 触发依赖分类
      - 统计每轮的工具调用结果
3. 按 sessionId 聚合，生成每个会话的报告
4. 汇总所有会话，生成全局 summary.md
```

### 13.3 离线扫描的特别关注点

针对离线内网环境，扫描器特别关注以下模式：

| 关注点 | JSONL 中的特征 | 分类 |
|--------|----------------|------|
| **Python 依赖缺失** | tool content 中出现 `ModuleNotFoundError`、`No module named` | `DEP` / `dep_python_missing` |
| **pip 离线安装失败** | tool content 中出现 `Could not find a version`、`network is unreachable` | `DEP` / `dep_pip_install_failed` |
| **中文路径乱码** | tool content 中出现 `\\ufffd`（替换字符）、`UnicodeDecodeError` | `ENCODING` / `enc_path_chinese` |
| **文件编码错误** | tool content 中出现 `EINVAL`、`codec can't decode` | `ENCODING` / `enc_file_read_error` |
| **npm 离线失败** | tool content 中出现 `ECONNREFUSED`、`ETIMEDOUT`、`network error` | `DEP` / `dep_node_missing` |
| **API 离线不可用** | content 中出现 `LLM API error.*ECONNREFUSED` | `API` / `api_call_failed` |
| **Agent 死循环** | 同一工具连续被调用 >5 次且参数相似 | `AGENT` / `agent_loop_stuck` |
| **工作目录越界** | tool args 中 path 不在 workDir 下 | `PERM` / `perm_path_denied` |

### 13.4 报告输出示例（离线场景）

```markdown
# 会话问题报告

> 会话: 在内网环境部署 Flask 应用
> 会话 ID: abc123...
> 生成时间: 2026-04-03T10:00:00.000Z
> 环境: 离线内网

## 概览

| 指标 | 值 |
|------|-----|
| 总问题数 | 12 |
| 已解决 | 7 |
| 未解决 | 5 |
| 解决率 | 58.3% |

## 按分类统计

| 分类 | 数量 | 占比 |
|------|------|------|
| 依赖问题 (DEP) | 4 | 33.3% |
| 编码问题 (ENCODING) | 3 | 25.0% |
| 工具执行问题 (TOOL) | 2 | 16.7% |
| LLM API 问题 (API) | 2 | 16.7% |
| 智能体交互问题 (AGENT) | 1 | 8.3% |

## 问题详情

### DEP-001 | Python 依赖缺失 | `bash`
- **时间**: 2026-04-03T09:15:00.000Z
- **严重程度**: error
- **描述**: ModuleNotFoundError: No module named 'flask'
- **参数**: `{"command": "python app.py"}`
- **状态**: ✅ 已解决（Agent 执行 pip install flask）

### DEP-002 | pip 离线安装失败 | `bash`
- **时间**: 2026-04-03T09:16:30.000Z
- **严重程度**: error
- **描述**: pip install flask ... ERROR: Could not find a version that satisfies the requirement
- **参数**: `{"command": "pip install flask"}`
- **状态**: ❌ 未解决
- **建议**: 需要在内网搭建 pip 镜像源或使用离线 wheel 包

### ENCODING-001 | 文件路径含中文 | `bash`
- **时间**: 2026-04-03T09:20:00.000Z
- **严重程度**: warning
- **描述**: cat: /home/user/文档/config.json: No such file or directory
- **参数**: `{"command": "cat /home/user/文档/config.json"}`
- **状态**: ✅ 已解决（Agent 改用英文路径）

### AGENT-001 | Agent 死循环 | —
- **时间**: 2026-04-03T09:25:00.000Z
- **严重程度**: warning
- **描述**: bash 工具连续被调用 8 次执行相同命令 `ls /opt`
- **状态**: ❌ 未解决
- **建议**: 增加重复操作检测机制，连续 3 次相同操作后自动中断

## 环境建议

1. **[DEP] 依赖安装 (4 次，未解决 1 次)**: 内网环境需要预配置本地 pip/npm 镜像
2. **[ENCODING] 编码问题 (3 次)**: 建议统一使用英文路径，系统 locale 设为 UTF-8
3. **[AGENT] Agent 交互 (1 次)**: Agent 在工具失败时策略不够智能，需要增强重试逻辑
```
