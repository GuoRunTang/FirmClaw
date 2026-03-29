# FirmClaw Phase 5 设计文档

> **状态**: 设计中
> **基于**: v4.0.0 (Phase 1 + Phase 2 + Phase 3 + Phase 4 完成)
> **目标版本**: v5.0.0
> **前置版本**: v4.1.0 → v4.2.0 → v4.3.0 → v4.4.0 → v4.5.0

---

## 一、Phase 5 目标

**让 FirmClaw 成为安全、可审计、可自主运行的生产级智能体系统。**

当前（v4.0）的系统已经具备完整的 ReAct 循环、会话管理、上下文压缩和记忆搜索能力。但在安全性、可观测性和自主性方面仍有欠缺：

1. **工具执行没有人工干预能力** — 权限系统是纯同步自动判断，危险操作（如 `rm -rf`）无法让人类决策
2. **没有操作审计记录** — 谁在什么时候执行了什么操作、结果如何，无从追溯
3. **没有自主循环能力** — 智能体只能被动响应用户输入，无法定时或主动执行任务
4. **会话是线性的** — 无法从某个历史节点分叉出新的探索方向
5. **工具执行缺乏可扩展的拦截机制** — 无法在工具执行前后插入自定义逻辑（如日志、变更记录）

Phase 5 将实现：

1. **人工审批流程（Human-in-the-Loop）** — 危险工具调用暂停等待用户确认
2. **Prompt Injection 防护** — 扫描工具返回结果中的注入攻击
3. **审计日志** — 全量操作记录，支持查询和导出
4. **Heartbeat 自主循环** — 智能体可按间隔自动执行任务
5. **会话分支** — 从历史节点创建分支会话
6. **工具执行钩子（Hook）** — before/after hook 机制

---

## 二、设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 人工审批通信机制 | **Promise + 回调模式** | 不引入新依赖；利用现有 readline 输入；agent 循环自然暂停等待 Promise resolve |
| 审批策略配置 | **按工具名 + 按风险等级** | 细粒度控制：`bash` 可设为"写入操作需审批"，`read_file` 可设为"全部自动" |
| 审计日志存储 | **独立 JSONL 文件**（`~/.firmclaw/audit.jsonl`） | 与会话文件分离；append-only；可通过 `/audit` 命令查询 |
| Prompt Injection 防护 | **正则扫描 + 内容标记** | 不依赖 LLM 二次调用；轻量高效；对可疑内容注入警告而非阻断 |
| Heartbeat 实现 | **AgentLoop 内部 setInterval** | 复用现有 `run()` 方法；不引入新的调度框架 |
| 会话分支实现 | **JSONL 复制 + 新 session** | 分支时复制指定行数之前的内容到新文件；元数据标记 parentSessionId |
| Hook 机制 | **同步 + 异步双模式** | before hook 可同步修改参数或拒绝执行；after hook 可异步处理结果 |

---

## 三、模块架构

### 3.1 新增文件总览

```
src/
├── agent/
│   ├── approval-gateway.ts     ← [v4.1] 人工审批网关（Promise + 回调）
│   ├── prompt-guard.ts         ← [v4.2] Prompt Injection 防护
│   └── heartbeat.ts            ← [v4.4] Heartbeat 自主循环
├── audit/
│   ├── logger.ts               ← [v4.3] 审计日志记录器
│   ├── types.ts                ← [v4.3] 审计日志类型定义
│   └── query.ts                ← [v4.3] 审计日志查询器
├── tools/
│   └── hook-manager.ts         ← [v4.5] 工具执行钩子管理器
├── session/
│   └── branch-manager.ts       ← [v4.5] 会话分支管理器（也可归入 manager.ts）
├── tests/
│   ├── test-approval-gateway.ts  ← [v4.1]
│   ├── test-prompt-guard.ts      ← [v4.2]
│   ├── test-audit-logger.ts      ← [v4.3]
│   ├── test-heartbeat.ts         ← [v4.4]
│   └── test-hook-manager.ts      ← [v4.5]
```

### 3.2 修改文件

```
src/
├── agent/
│   ├── agent-loop.ts        ← [v4.1] 集成 ApprovalGateway（工具执行前暂停审批）
│   └── types.ts             ← [v4.1] AgentConfig 新增 approvalMode / autoApproveTools
├── tools/
│   ├── registry.ts          ← [v4.2] execute() 集成 PromptGuard + HookManager
│   ├── permissions.ts       ← [v4.1] 新增 riskLevel 概念（low/medium/high）
│   └── context.ts           ← [v4.5] ToolContext 扩展 hook 相关字段
├── session/
│   ├── manager.ts           ← [v4.5] 新增 branch() 方法
│   ├── types.ts             ← [v4.5] SessionMeta 新增 parentSessionId / branchPoint
│   └── store.ts             ← [v4.5] 新增 copyUpTo() 方法
├── utils/
│   └── event-stream.ts      ← [v4.1] 新增 approval_requested / approval_resolved / audit_logged 事件
├── index.ts                 ← [v4.1~4.5] 新增斜杠命令 /approve /deny /audit /branch /hook
```

### 3.3 架构图

```
                        ┌─────────────────────────────────────────────┐
                        │              CLI (index.ts)                  │
                        │  - /approve               批准待审批操作     │
                        │  - /deny                  拒绝待审批操作     │
                        │  - /audit [filter]        查看审计日志       │
                        │  - /branch [n]            创建分支会话       │
                        │  - /heartbeat start/stop  启停自主循环       │
                        │  - /hooks                 查看已注册钩子     │
                        └──────────────┬──────────────────────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────────────────────┐
                        │           AgentLoop (改造)                    │
                        │                                              │
                        │  run(userMessage) {                          │
                        │    ① contextBuilder.build()                  │
                        │       └→ searchEngine.search()               │
                        │       └→ memoryManager.getTopK()             │
                        │    ② summarizer.shouldSummarize()?           │
                        │    ③ tokenCounter.trim()                     │
                        │    ④ LLM.chat(messages) ← ReAct循环          │
                        │    ⑤ 工具执行循环:                            │
                        │       ├─ hookManager.runBeforeHooks()  ←新  │
                        │       ├─ promptGuard.scan(toolResult)  ←新  │
                        │       ├─ approvalGateway.request()     ←新  │
                        │       │   └→ [等待用户 y/n]               │
                        │       ├─ registry.execute()                 │
                        │       ├─ auditLogger.log()            ←新  │
                        │       └─ hookManager.runAfterHooks()   ←新  │
                        │    ⑥ searchEngine.index() ← 结果             │
                        │  }                                           │
                        └──┬────────┬────────┬────────┬──────────┬───┘
                           │        │        │        │          │
                  ┌────────┘        │        │        │          └────────┐
                  ▼                 ▼        ▼        ▼                   ▼
    ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  ApprovalGateway │ │  Prompt  │ │  Audit   │ │Heartbeat │ │   Hook   │
    │  (v4.1)          │ │  Guard   │ │  Logger  │ │  (v4.4)  │ │ Manager  │
    │                  │ │  (v4.2)  │ │  (v4.3)  │ │          │ │  (v4.5)  │
    │ - request()      │ │          │ │          │ │ - start  │ │          │
    │ - resolve()      │ │ - scan   │ │ - log    │ │ - stop   │ │ - before │
    │ - autoApprove    │ │ - clean  │ │ - query  │ │ - tick   │ │ - after  │
    └──────────────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

## 四、版本拆分与详细设计

### v4.1.0：人工审批流程（Human-in-the-Loop）

**目标**：危险工具调用暂停等待用户确认，安全操作自动放行。

#### 4.1.1 核心设计思路

当前系统是**单向数据流**：Agent Loop → emit events → CLI displays。

Phase 5 需要引入**反向控制流**：CLI user input → approve/deny → Agent Loop continues。

解决方案：在 `EventStream` 上增加 `requestApproval()` 方法，返回 `Promise<ApprovalResult>`。CLI 订阅 `approval_requested` 事件后弹出提示，用户输入后调用 `resolveApproval()` 来 resolve 这个 Promise。Agent Loop 在 `await gateway.request()` 处自然暂停。

```
Agent Loop                          CLI (readline)
    │                                    │
    ├─ gateway.request(toolName, args)   │
    │  └─ new Promise → 暂停等待         │
    │       │                            │
    │       ├──── emit('approval_requested') ────→ 显示审批提示
    │       │                                  用户输入 y/n
    │       │←──── gateway.resolve(true) ──────┘
    │       │                            │
    ├─ 继续执行                          │
    │                                    │
```

#### 4.1.2 `src/agent/approval-gateway.ts` — 审批网关

```typescript
/**
 * src/agent/approval-gateway.ts
 *
 * 人工审批网关 —— 危险工具调用的暂停/恢复机制。
 *
 * 设计要点：
 * - 通过 Promise + 回调模式实现异步等待
 * - Agent Loop 在 request() 处暂停，CLI 通过 resolve() 恢复
 * - 支持超时自动拒绝（防止永远阻塞）
 * - 支持配置自动批准的工具列表
 *
 * v4.1: 初始实现
 */

/** 审批请求 */
export interface ApprovalRequest {
  /** 唯一请求 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 风险等级（来自权限策略） */
  riskLevel: 'low' | 'medium' | 'high';
  /** 请求时间 */
  timestamp: string;
}

/** 审批结果 */
export type ApprovalResult = 'approved' | 'denied' | 'timeout';

/** 审批网关配置 */
export interface ApprovalGatewayConfig {
  /** 自动批准的工具列表（这些工具不需要人工确认） */
  autoApproveTools?: string[];
  /** 审批超时时间（毫秒，默认 300000 = 5 分钟） */
  timeoutMs?: number;
  /** 审批模式：'strict' 全部需确认 / 'risk-based' 按风险等级 / 'auto' 全部自动 */
  mode?: 'strict' | 'risk-based' | 'auto';
}

export class ApprovalGateway {
  private config: Required<ApprovalGatewayConfig>;
  private pendingResolve: ((result: ApprovalResult) => void) | null = null;
  private pendingRequest: ApprovalRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: ApprovalGatewayConfig);

  /**
   * 发起审批请求（会阻塞直到 resolve 或超时）
   *
   * 如果工具在 autoApproveTools 中，直接返回 'approved'
   * 如果 mode 为 'auto'，直接返回 'approved'
   * 否则挂起 Promise，等待外部调用 resolve()
   */
  async request(toolName: string, args: Record<string, unknown>, riskLevel?: 'low' | 'medium' | 'high'): Promise<ApprovalResult>;

  /**
   * 解决当前挂起的审批请求
   */
  resolve(result: 'approved' | 'denied'): boolean;

  /**
   * 获取当前挂起的审批请求（供 CLI 展示详情）
   */
  getPendingRequest(): ApprovalRequest | null;

  /** 清理超时计时器 */
  private clearTimer(): void;

  /** 启动超时计时器 */
  private startTimer(): void;
}
```

#### 4.1.3 `src/tools/permissions.ts` — 新增风险等级

在现有 `PermissionResult` 基础上扩展：

```typescript
/** 权限检查结果（v4.1 扩展） */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  /** 风险等级（v4.1: 供审批网关判断是否需要人工确认） */
  riskLevel?: 'low' | 'medium' | 'high';
}
```

`DefaultPermissionPolicy` 的风险等级判定规则：

| 操作类型 | 风险等级 | 示例 |
|---------|---------|------|
| `read_file` | `low` | 读取任何文件 |
| `bash`（只读命令） | `low` | `ls`, `git status`, `cat` |
| `write_file`（新文件） | `medium` | 创建新文件 |
| `edit_file` | `medium` | 修改已有文件 |
| `bash`（写入/安装命令） | `medium` | `npm install`, `git commit` |
| `bash`（删除命令） | `high` | `rm`, `del`, `git reset --hard` |
| `write_file`（覆盖敏感文件） | `high` | 写入 `.env`（当前已禁止，升级为需审批） |

判定策略：在 `checkCommand()` 中增加前缀匹配逻辑：

```typescript
// 写入/删除命令 → high
if (/^rm\s|^del\s|^rmdir\s|^git\s+reset\s|^git\s+push\s|--force/.test(command)) {
  return { allowed: true, riskLevel: 'high' };
}
// 安装/构建命令 → medium
if (/npm|yarn|pnpm|pip|cargo|go\s+install|make|cmake/.test(command)) {
  return { allowed: true, riskLevel: 'medium' };
}
// 其他 → low
return { allowed: true, riskLevel: 'low' };
```

#### 4.1.4 `src/agent/agent-loop.ts` — 集成审批网关

在工具执行循环中插入审批等待逻辑（在 `tool_start` 和 `registry.execute()` 之间）：

```typescript
// 工具执行前：人工审批（v4.1）
if (this.approvalGateway) {
  const { riskLevel } = this.tools.checkPermissionWithRisk(toolName, toolArgs, toolContext);
  const result = await this.approvalGateway.request(toolName, toolArgs, riskLevel);
  
  if (result === 'denied' || result === 'timeout') {
    const denyMsg = result === 'timeout'
      ? `Tool "${toolName}" approval timed out (${this.approvalGateway.getTimeout()}ms)`
      : `Tool "${toolName}" denied by user`;
    
    this.events.emit('approval_denied', { toolName, args: toolArgs, reason: result });
    const toolMsg = { role: 'tool' as const, content: denyMsg, tool_call_id: toolCall.id };
    allMessages.push(toolMsg);
    roundMessages.push(toolMsg);
    continue;
  }
  
  this.events.emit('approval_granted', { toolName, args: toolArgs });
}
```

#### 4.1.5 `src/utils/event-stream.ts` — 新增事件类型

```typescript
export type AgentEventType =
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_end'
  | 'message_end'
  | 'error'
  | 'session_start'
  | 'context_trimmed'
  | 'summary_generated'
  | 'memory_saved'
  // v4.1: 审批事件
  | 'approval_requested'     // { id, toolName, args, riskLevel }
  | 'approval_granted'       // { toolName, args }
  | 'approval_denied'        // { toolName, args, reason }
  // v4.2: 安全事件
  | 'prompt_injection_detected'  // { toolName, content, matchType }
  // v4.3: 审计事件
  | 'audit_logged';          // { auditId, toolName, result }
```

#### 4.1.6 `src/index.ts` — CLI 集成审批流程

```typescript
// 订阅审批请求事件
events.on('approval_requested', (e) => {
  const data = e.data as ApprovalRequest;
  console.log(`\n⚠️  [APPROVAL REQUIRED] Tool: ${data.toolName}`);
  console.log(`   Risk Level: ${data.riskLevel}`);
  console.log(`   Args: ${JSON.stringify(data.args)}`);
  console.log(`   Type "y" to approve, "n" to deny (timeout: ${timeout / 1000}s)`);
  rl.question('   > ', (input: string) => {
    const answer = input.trim().toLowerCase();
    approvalGateway.resolve(answer === 'y' || answer === 'yes' ? 'approved' : 'denied');
  });
});
```

新增斜杠命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/approve` | 批准当前待审批操作 | `> /approve` |
| `/deny` | 拒绝当前待审批操作 | `> /deny` |
| `/approval` | 查看当前审批模式配置 | `> /approval` |
| `/set-approval <mode>` | 设置审批模式 | `> /set-approval risk-based` |

#### 4.1.7 `src/agent/types.ts` — AgentConfig 扩展

```typescript
import type { ApprovalGateway } from './approval-gateway.js';
import type { ApprovalGatewayConfig } from './approval-gateway.js';

export interface AgentConfig {
  // ... 现有字段 ...
  /** 人工审批网关（v4.1: 可选，设置后启用人工审批） */
  approvalGateway?: ApprovalGateway;
  /** 审批网关配置（v4.1） */
  approvalConfig?: ApprovalGatewayConfig;
}
```

#### 4.1.8 测试：`src/tests/test-approval-gateway.ts`

| 测试用例 | 说明 |
|----------|------|
| 自动批准工具直接放行 | autoApproveTools 中的工具不暂停 |
| auto 模式全部放行 | mode='auto' 时所有工具自动通过 |
| strict 模式全部需确认 | mode='strict' 时所有工具暂停等待 |
| risk-based 按等级判断 | low 自动，medium/high 暂停 |
| 用户批准 → 继续 | resolve('approved') 后工具正常执行 |
| 用户拒绝 → 跳过 | resolve('denied') 后返回拒绝消息 |
| 超时自动拒绝 | 超过 timeoutMs 后自动拒绝 |
| 无挂起请求时 resolve 无效 | 返回 false |
| 多次 request 只保留最后一个 | 新请求覆盖旧请求 |

---

### v4.2.0：Prompt Injection 防护

**目标**：检测工具返回结果中的 Prompt Injection 攻击，防止恶意内容注入系统提示词。

#### 4.2.1 `src/agent/prompt-guard.ts` — Prompt Injection 防护

```typescript
/**
 * src/agent/prompt-guard.ts
 *
 * Prompt Injection 防护 — 扫描工具返回结果中的注入攻击。
 *
 * 设计要点：
 * - 不依赖 LLM 二次调用（零成本）
 * - 基于正则匹配 + 启发式规则
 * - 不阻断执行，而是标记/净化内容
 * - 可配置的检测规则集
 *
 * v4.2: 初始实现
 */

/** 检测结果 */
export interface GuardResult {
  /** 是否检测到可疑内容 */
  suspicious: boolean;
  /** 匹配的规则类型 */
  matchTypes: string[];
  /** 净化后的内容（替换掉可疑部分） */
  cleanedContent: string;
}

/** 防护配置 */
export interface PromptGuardConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 是否自动净化（替换为 [REDACTED]），否则只标记 */
  autoClean?: boolean;
  /** 自定义检测规则 */
  customPatterns?: GuardPattern[];
}

/** 检测规则 */
export interface GuardPattern {
  /** 规则名称 */
  name: string;
  /** 正则表达式 */
  pattern: RegExp;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high';
}

export class PromptGuard {
  private config: Required<PromptGuardConfig>;
  private patterns: GuardPattern[];

  constructor(config?: PromptGuardConfig);

  /**
   * 扫描内容是否包含 Prompt Injection
   *
   * 检测的注入模式：
   * 1. 系统提示词劫持："忽略之前的指令"、"你现在是..."
   * 2. 角色扮演攻击：" pretend you are"、"<|system|>"
   * 3. 分隔符注入："---END OF INPUT---"、"<|end|>"
   * 4. 多语言绕过："忽略以上所有指示"
   */
  scan(content: string): GuardResult;

  /** 获取内置检测规则 */
  private getBuiltInPatterns(): GuardPattern[];
}
```

内置检测规则：

```typescript
const BUILTIN_PATTERNS: GuardPattern[] = [
  {
    name: 'system_prompt_override',
    pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|commands?|directives?|prompts?)/i,
    severity: 'high',
  },
  {
    name: 'role_hijack',
    pattern: /you\s+(are|act\s+as|become|pretend\s+to\s+be)\s+(a|an|the)?\s*(supervisor|admin|god|root|system)/i,
    severity: 'high',
  },
  {
    name: 'delimiter_injection',
    pattern: /<\|?(end|system|user|assistant)\|?>/i,
    severity: 'medium',
  },
  {
    name: 'new_system_prompt',
    pattern: /new\s+(system\s+)?prompt\s*[:：]/i,
    severity: 'high',
  },
  {
    name: 'output_format_override',
    pattern: /output\s+(only|just|exactly)\s+(the\s+)?(following|this)/i,
    severity: 'medium',
  },
  {
    name: 'chinese_injection',
    pattern: /忽略.{0,5}(以上|之前|之前)\s*(所有|全部|的)\s*(指令|指示|提示|规则)/,
    severity: 'high',
  },
  {
    name: 'markdown_injection',
    pattern: /\[INST\]|\[/INST\]|<\|im_start\|>|\[\[SYSTEM\]\]/i,
    severity: 'high',
  },
];
```

#### 4.2.2 集成点 — `src/tools/registry.ts`

在 `execute()` 方法中，工具执行后、返回前扫描结果：

```typescript
// 4. 执行
const result = await tool.execute(params, context);

// v4.2: Prompt Injection 防护
if (this.promptGuard) {
  const guardResult = this.promptGuard.scan(result.content);
  if (guardResult.suspicious) {
    // 通知外部
    this.eventStream?.emit('prompt_injection_detected', {
      toolName: name,
      matchTypes: guardResult.matchTypes,
    });
    // 返回净化后的内容
    return {
      content: guardResult.cleanedContent,
      isError: result.isError,
    };
  }
}

return result;
```

#### 4.2.3 测试：`src/tests/test-prompt-guard.ts`

| 测试用例 | 说明 |
|----------|------|
| 检测系统提示词劫持 | "ignore all previous instructions" → suspicious |
| 检测角色扮演攻击 | "pretend you are god" → suspicious |
| 检测分隔符注入 | "<\|end\|>" → suspicious |
| 检测中文注入 | "忽略以上所有指令" → suspicious |
| 正常内容不触发 | "Hello, here is the file content" → clean |
| 净化模式 | 可疑部分替换为 [REDACTED] |
| 仅标记模式 | autoClean=false 时不修改内容 |
| 自定义规则 | 用户可添加额外检测模式 |
| 空内容处理 | 不崩溃 |
| 长内容性能 | 100KB 内容扫描 < 50ms |

---

### v4.3.0：审计日志

**目标**：全量记录智能体的操作行为，支持查询和追溯。

#### 4.3.1 审计日志格式

存储路径：`~/.firmclaw/audit.jsonl`

每行一条 JSON 记录：

```json
{"id":"aud_001","timestamp":"2026-03-29T16:00:00.000Z","sessionId":"abc123","eventType":"tool_execution","toolName":"bash","args":{"command":"ls -la"},"riskLevel":"low","approvedBy":"auto","result":"success","output":"total 128\ndrwxr-xr-x  ...","durationMs":45}
{"id":"aud_002","timestamp":"2026-03-29T16:00:01.000Z","sessionId":"abc123","eventType":"approval","toolName":"bash","args":{"command":"rm -rf build/"},"riskLevel":"high","approvedBy":"user","result":"approved","output":"","durationMs":120000}
{"id":"aud_003","timestamp":"2026-03-29T16:00:05.000Z","sessionId":"abc123","eventType":"prompt_injection","toolName":"read_file","args":{"path":"suspicious.txt"},"riskLevel":"low","matchTypes":["system_prompt_override"],"result":"cleaned","durationMs":0}
```

#### 4.3.2 `src/audit/types.ts` — 审计日志类型

```typescript
/** 审计事件类型 */
export type AuditEventType =
  | 'tool_execution'      // 工具执行
  | 'approval'            // 人工审批
  | 'prompt_injection'    // 注入检测
  | 'session_start'       // 会话开始
  | 'session_end'         // 会话结束
  | 'config_change';      // 配置变更

/** 审批来源 */
export type ApprovalSource = 'auto' | 'user' | 'timeout' | 'policy';

/** 单条审计记录 */
export interface AuditEntry {
  /** 审计记录唯一 ID */
  id: string;
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 关联的会话 ID */
  sessionId?: string;
  /** 事件类型 */
  eventType: AuditEventType;
  /** 工具名称（仅 tool_execution / approval / prompt_injection） */
  toolName?: string;
  /** 工具参数（仅 tool_execution / approval / prompt_injection） */
  args?: Record<string, unknown>;
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 审批来源 */
  approvedBy?: ApprovalSource;
  /** 执行结果 */
  result: string;
  /** 输出摘要（截断到 500 字） */
  output?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
}

/** 审计查询条件 */
export interface AuditQuery {
  /** 按会话 ID 过滤 */
  sessionId?: string;
  /** 按事件类型过滤 */
  eventType?: AuditEventType;
  /** 按工具名过滤 */
  toolName?: string;
  /** 按风险等级过滤 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 按时间范围过滤 */
  from?: string;
  /** 按时间范围过滤 */
  to?: string;
  /** 最大返回数量（默认 50） */
  limit?: number;
  /** 是否只看被拒绝的 */
  deniedOnly?: boolean;
}
```

#### 4.3.3 `src/audit/logger.ts` — 审计日志记录器

```typescript
/**
 * src/audit/logger.ts
 *
 * 审计日志记录器 —— append-only JSONL 写入。
 *
 * v4.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AuditEntry, AuditEventType } from './types.js';

export class AuditLogger {
  private filePath: string;
  private seq: number;

  constructor(auditDir?: string);

  /**
   * 记录一条审计日志
   */
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<string>;

  /**
   * 批量记录
   */
  async logBatch(entries: Omit<AuditEntry, 'id' | 'timestamp'>[]): Promise<string[]>;

  /** 生成审计 ID */
  private nextId(): string;

  /** 确保目录和文件存在 */
  private async ensureFile(): Promise<void>;
}
```

#### 4.3.4 `src/audit/query.ts` — 审计日志查询器

```typescript
/**
 * src/audit/query.ts
 *
 * 审计日志查询器 —— 支持按条件过滤和聚合。
 *
 * v4.3: 初始实现
 */

import type { AuditEntry, AuditQuery } from './types.js';

export class AuditQuery {
  private filePath: string;

  constructor(auditDir?: string);

  /**
   * 按条件查询审计记录
   */
  async query(filter?: AuditQuery): Promise<AuditEntry[]>;

  /**
   * 获取统计摘要
   */
  async stats(): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
    byTool: Record<string, number>;
    byRiskLevel: Record<string, number>;
    totalDurationMs: number;
    deniedCount: number;
  }>;

  /**
   * 导出为 CSV 格式
   */
  async exportCSV(filter?: AuditQuery): Promise<string>;
}
```

#### 4.3.5 CLI 集成 — 新增斜杠命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/audit [filter]` | 查看审计日志 | `> /audit` / `> /audit --tool=bash` / `> /audit --risk=high` |
| `/audit-stats` | 审计统计摘要 | `> /audit-stats` |
| `/audit-export [file]` | 导出审计日志为 CSV | `> /audit-export audit.csv` |

#### 4.3.6 测试：`src/tests/test-audit-logger.ts`

| 测试用例 | 说明 |
|----------|------|
| 写入一条记录 → 文件可读 | 基础写入 |
| 批量写入 | 多条记录原子追加 |
| ID 自增 | aud_001 → aud_002 → aud_003 |
| 查询按工具过滤 | 只返回 bash 的记录 |
| 查询按风险等级 | 只返回 high 的记录 |
| 查询按时间范围 | from/to 过滤 |
| 统计摘要 | 各维度计数正确 |
| 导出 CSV | 格式正确 |
| 空文件查询 | 返回空数组 |
| 损坏行容错 | 跳过非法 JSON 行 |

---

### v4.4.0：Heartbeat 自主循环

**目标**：智能体可按间隔自动执行任务，支持启动/停止/状态查询。

#### 4.4.1 `src/agent/heartbeat.ts` — 心跳管理器

```typescript
/**
 * src/agent/heartbeat.ts
 *
 * Heartbeat 心跳管理器 — 让智能体自主执行任务。
 *
 * 设计要点：
 * - 复用 AgentLoop.run() 执行任务
 * - setInterval 定时触发
 * - 支持最多 N 次循环后自动停止
 * - 错误不中断心跳，记录错误继续下一轮
 *
 * v4.4: 初始实现
 */

/** 心跳配置 */
export interface HeartbeatConfig {
  /** 任务 prompt（智能体每轮执行的内容） */
  taskPrompt: string;
  /** 循环间隔（毫秒，默认 60000 = 1 分钟） */
  intervalMs?: number;
  /** 最大循环次数（0 = 无限，默认 10） */
  maxTicks?: number;
  /** 是否启用（默认 false） */
  enabled?: boolean;
}

/** 心跳状态 */
export type HeartbeatStatus = 'idle' | 'running' | 'paused' | 'stopped';

/** 心跳统计 */
export interface HeartbeatStats {
  status: HeartbeatStatus;
  ticksCompleted: number;
  ticksRemaining: number;
  totalDurationMs: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  errorCount: number;
}

export class Heartbeat {
  private config: Required<Omit<HeartbeatConfig, 'enabled'>>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: HeartbeatStatus = 'idle';
  private ticksCompleted = 0;
  private errors = 0;
  private startTime: number | null = null;
  private lastTickAt: string | null = null;
  private onTick: (prompt: string) => Promise<void>;

  constructor(config: HeartbeatConfig, onTick: (prompt: string) => Promise<void>);

  /**
   * 启动心跳
   */
  start(): void;

  /**
   * 停止心跳
   */
  stop(): void;

  /**
   * 暂停心跳
   */
  pause(): void;

  /**
   * 恢复心跳
   */
  resume(): void;

  /** 获取当前状态 */
  getStats(): HeartbeatStats;

  /** 更新任务 prompt */
  updatePrompt(prompt: string): void;

  /** 执行一轮心跳 */
  private async tick(): Promise<void>;
}
```

#### 4.4.2 与 AgentLoop 的集成

Heartbeat 不直接修改 AgentLoop，而是在 `index.ts` 层组合：

```typescript
const heartbeat = new Heartbeat(
  { taskPrompt: '检查项目是否有编译错误，如果有则修复', intervalMs: 60000, maxTicks: 10 },
  async (prompt) => {
    try {
      const result = await agent.run(prompt);
      console.log(`[Heartbeat] Tick #${heartbeat.getStats().ticksCompleted}: ${result.turns} turns, ${result.toolCalls} tool calls`);
    } catch (error) {
      console.error(`[Heartbeat] Error: ${error}`);
    }
  }
);
```

#### 4.4.3 CLI 集成 — 新增斜杠命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/heartbeat start <prompt>` | 启动心跳 | `> /heartbeat start 每分钟检查构建状态` |
| `/heartbeat stop` | 停止心跳 | `> /heartbeat stop` |
| `/heartbeat pause` | 暂停心跳 | `> /heartbeat pause` |
| `/heartbeat resume` | 恢复心跳 | `> /heartbeat resume` |
| `/heartbeat status` | 查看心跳状态 | `> /heartbeat status` |

#### 4.4.4 测试：`src/tests/test-heartbeat.ts`

| 测试用例 | 说明 |
|----------|------|
| 启动 → 运行指定次数后停止 | maxTicks 限制 |
| 停止后不再触发 | timer 已清除 |
| 暂停 → 恢复 | 暂停期间不执行 |
| 更新 prompt | 下一轮使用新 prompt |
| 错误不中断心跳 | 错误计数 +1，继续下一轮 |
| 状态统计准确 | ticksCompleted / errorCount / duration |
| 空闲状态操作 | stop/pause idle 状态不报错 |
| 间隔时间正确 | setInterval 参数正确 |

---

### v4.5.0：会话分支 + 工具钩子

**目标**：支持从历史节点分叉会话；工具执行前后可插入自定义逻辑。

#### 4.5.1 会话分支设计

分支是 Git branch 概念的会话化实现：

```
原始会话 (abc123):                 分支会话 (def456):
  msg1: "帮我重构代码"               msg1: "帮我重构代码"
  msg2: "好的，我来看一下"            msg2: "好的，我来看一下"
  msg3: "我建议使用工厂模式"          msg3: "我建议使用工厂模式"
  msg4: "好的，开始实现"              ← 分支点 (branch from msg3)
  msg5: "实现了..."                   msg4: "不，我觉得用策略模式更好"
  msg6: "完成了"                     msg5: "好的，用策略模式实现..."
```

**实现方案**：在 `SessionStore` 新增 `copyUpTo(sessionId, lineCount)` 方法，将指定行数之前的消息复制到新文件。

#### 4.5.2 `src/session/types.ts` — SessionMeta 扩展

```typescript
export interface SessionMeta {
  // ... 现有字段 ...
  /** 父会话 ID（v4.5: 分支来源） */
  parentSessionId?: string;
  /** 分支点消息序号（v4.5: 从第几条消息开始分叉） */
  branchPoint?: number;
}
```

#### 4.5.3 `src/session/store.ts` — 新增分支方法

```typescript
/**
 * 复制指定会话的前 N 条消息到新会话
 *
 * @param sourceSessionId - 源会话 ID
 * @param newSessionId - 新会话 ID
 * @param upToLine - 复制到第几条消息（0 = 全部）
 */
async branchFrom(sourceSessionId: string, newSessionId: string, upToLine: number): Promise<void>;
```

#### 4.5.4 `src/session/manager.ts` — 新增 branch 方法

```typescript
/**
 * 从当前会话的指定消息处创建分支
 *
 * @param fromMessageIndex - 从第几条消息开始分叉（0-based）
 * @param newTitle - 分支会话标题
 */
async branch(fromMessageIndex: number, newTitle?: string): Promise<SessionMeta>;
```

#### 4.5.5 工具钩子设计

Hook 机制允许在工具执行前后插入自定义逻辑：

```typescript
/**
 * src/tools/hook-manager.ts
 *
 * 工具执行钩子管理器。
 *
 * v4.5: 初始实现
 */

/** 钩子上下文 */
export interface HookContext {
  /** 工具名称 */
  toolName: string;
  /** 工具参数（before hook 可修改） */
  args: Record<string, unknown>;
  /** 工具执行结果（仅 after hook 有值） */
  result?: { content: string; isError?: boolean };
  /** 工具上下文 */
  toolContext: ToolContext;
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high';
}

/** Before Hook 签名 — 可修改参数或拒绝执行 */
export type BeforeHook = (ctx: HookContext) => 
  | void                              // 放行
  | { args: Record<string, unknown> } // 修改参数后放行
  | { deny: true; reason: string };   // 拒绝执行;

/** After Hook 签名 — 可处理结果 */
export type AfterHook = (ctx: HookContext) => void | Promise<void>;

export class HookManager {
  private beforeHooks: Map<string, BeforeHook[]> = new Map();
  private afterHooks: Map<string, AfterHook[]> = new Map();

  /**
   * 注册 before hook
   * @param toolName - 工具名（'*' = 全部工具）
   */
  registerBefore(toolName: string, hook: BeforeHook): void;

  /**
   * 注册 after hook
   * @param toolName - 工具名（'*' = 全部工具）
   */
  registerAfter(toolName: string, hook: AfterHook): void;

  /**
   * 运行所有 before hooks
   * @returns 修改后的参数，或 null 表示拒绝
   */
  async runBeforeHooks(toolName: string, ctx: HookContext): Promise<Record<string, unknown> | null>;

  /**
   * 运行所有 after hooks
   */
  async runAfterHooks(toolName: string, ctx: HookContext): Promise<void>;

  /**
   * 获取已注册的钩子列表
   */
  listHooks(): { toolName: string; type: 'before' | 'after'; count: number }[];
}
```

#### 4.5.6 集成点 — `src/tools/registry.ts`

在 `execute()` 方法中集成钩子：

```typescript
async execute(name: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  // 1. 参数校验
  // ...

  // 2. 查找工具
  // ...

  // v4.5: Before Hooks
  if (this.hookManager) {
    const hookCtx = { toolName: name, args: params, toolContext: context, riskLevel: 'low' };
    const modifiedArgs = await this.hookManager.runBeforeHooks(name, hookCtx);
    if (modifiedArgs === null) {
      return { content: 'Execution denied by hook.', isError: true };
    }
    params = modifiedArgs;
  }

  // 3. 权限检查 + 人工审批
  // ...

  // 4. 执行
  const result = await tool.execute(params, context);

  // v4.5: After Hooks
  if (this.hookManager) {
    await this.hookManager.runAfterHooks(name, {
      toolName: name,
      args: params,
      result,
      toolContext: context,
    });
  }

  // v4.2: Prompt Injection 防护
  // ...

  return result;
}
```

#### 4.5.7 CLI 集成 — 新增斜杠命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/branch [n]` | 从第 n 条消息处创建分支 | `> /branch 5` |
| `/branches` | 列出当前会话的所有分支 | `> /branches` |
| `/hooks` | 列出已注册的工具钩子 | `> /hooks` |

#### 4.5.8 测试

**`src/tests/test-branch-manager.ts`**：

| 测试用例 | 说明 |
|----------|------|
| 创建分支 → 新会话有正确的消息 | 复制 upTo 之前的消息 |
| 分支元数据正确 | parentSessionId / branchPoint 字段 |
| 分支独立编辑 | 修改分支不影响原始会话 |
| fromMessageIndex 越界 | 自动取最大值 |
| 空会话分支 | 返回空分支 |

**`src/tests/test-hook-manager.ts`**：

| 测试用例 | 说明 |
|----------|------|
| before hook 修改参数 | 参数被正确修改后传给工具 |
| before hook 拒绝执行 | 返回 deny 消息 |
| after hook 接收结果 | 能拿到工具执行结果 |
| 通配符 hook | '*' 匹配所有工具 |
| 多个 hook 顺序执行 | 按注册顺序执行 |
| hook 抛出异常 | 不影响工具执行 |

---

### v5.0.0：全量整合 + 版本发布

**目标**：将 v4.1 ~ v4.5 的全部模块集成，发布 v5.0.0。

#### 4.6.1 `src/index.ts` 改造

初始化所有 Phase 5 组件：

```typescript
// Phase 5: 初始化审批网关
const approvalGateway = new ApprovalGateway({
  mode: 'risk-based',
  autoApproveTools: ['read_file'],
  timeoutMs: 300_000,
});

// Phase 5: 初始化 Prompt Guard
const promptGuard = new PromptGuard({
  enabled: true,
  autoClean: true,
});

// Phase 5: 初始化审计日志
const auditLogger = new AuditLogger();

// Phase 5: 初始化工具钩子
const hookManager = new HookManager();

// 注册内置 after hook（审计日志记录）
hookManager.registerAfter('*', async (ctx) => {
  await auditLogger.log({
    eventType: 'tool_execution',
    sessionId: ctx.toolContext.sessionId,
    toolName: ctx.toolName,
    args: ctx.args,
    riskLevel: ctx.riskLevel,
    approvedBy: 'auto',
    result: ctx.result?.isError ? 'error' : 'success',
    output: ctx.result?.content?.substring(0, 500),
  });
});

// 注入到 ToolRegistry
tools.setPromptGuard(promptGuard);
tools.setHookManager(hookManager);
```

#### 4.6.2 完整的 CLI 命令列表（v5.0）

| 命令 | Phase | 说明 |
|------|-------|------|
| `/help` | 1 | 显示帮助 |
| `/new` | 3 | 创建新会话 |
| `/resume [id]` | 3 | 恢复会话 |
| `/sessions` | 3 | 列出所有会话 |
| `/session` | 3 | 显示当前会话 |
| `/soul` | 3 | 显示 SOUL.md |
| `/memory [tag]` | 4 | 显示记忆 |
| `/remember <text>` | 4 | 保存记忆 |
| `/forget <id>` | 4 | 删除记忆 |
| `/search <query>` | 4 | 全文搜索 |
| `/compact` | 4 | 手动压缩 |
| `/index` | 4 | 索引统计 |
| `/approve` | **5** | 批准待审批操作 |
| `/deny` | **5** | 拒绝待审批操作 |
| `/approval` | **5** | 查看审批配置 |
| `/set-approval <mode>` | **5** | 设置审批模式 |
| `/audit [filter]` | **5** | 查看审计日志 |
| `/audit-stats` | **5** | 审计统计 |
| `/audit-export [file]` | **5** | 导出审计 CSV |
| `/heartbeat start/stop/pause/resume/status` | **5** | 心跳管理 |
| `/branch [n]` | **5** | 创建会话分支 |
| `/branches` | **5** | 列出分支 |
| `/hooks` | **5** | 列出钩子 |

---

## 五、依赖变更

Phase 5 **不引入新的外部依赖**。

所有新增功能均使用 Node.js 内置模块实现：
- 人工审批：Promise + readline（已有）
- Prompt Injection：正则匹配（内置 RegExp）
- 审计日志：`fs.appendFile()`（已有模式）
- Heartbeat：`setInterval`（内置）
- 会话分支：`fs.readFile` + `fs.writeFile`（已有）
- 工具钩子：纯逻辑（无依赖）

---

## 六、实现进度

| 版本 | 功能 | 状态 | Git Tag |
|------|------|------|---------|
| v4.1.0 | 人工审批流程 (ApprovalGateway + 风险等级) | ✅ 完成 | `v4.1.0` |
| v4.2.0 | Prompt Injection 防护 (PromptGuard) | ✅ 完成 | `v4.2.0` |
| v4.3.0 | 审计日志 (AuditLogger + AuditQuery) | ✅ 完成 | `v4.3.0` |
| v4.4.0 | Heartbeat 自主循环 | ✅ 完成 | `v4.4.0` |
| v4.5.0 | 会话分支 + 工具钩子 | ✅ 完成 | `v4.5.0` |
| v5.0.0 | 全量整合 + 版本发布 | ✅ 完成 | `v5.0.0` |

---

## 六、目录结构变更（完整 v5.0.0）

```
src/
├── agent/
│   ├── agent-loop.ts          ← v4.1: 集成 ApprovalGateway
│   ├── types.ts               ← v4.1: AgentConfig 新增 approvalGateway
│   ├── approval-gateway.ts    ← v4.1: 新增（人工审批网关）
│   ├── prompt-guard.ts        ← v4.2: 新增（Prompt Injection 防护）
│   └── heartbeat.ts           ← v4.4: 新增（心跳管理器）
├── audit/
│   ├── types.ts               ← v4.3: 新增（审计类型定义）
│   ├── logger.ts              ← v4.3: 新增（审计记录器）
│   └── query.ts               ← v4.3: 新增（审计查询器）
├── llm/
│   └── client.ts              ← 不变
├── session/
│   ├── types.ts               ← v4.5: SessionMeta 新增 parentSessionId / branchPoint
│   ├── store.ts               ← v4.5: 新增 branchFrom() 方法
│   ├── manager.ts             ← v4.5: 新增 branch() 方法
│   ├── context-builder.ts     ← 不变
│   ├── summarizer.ts          ← 不变
│   ├── memory-manager.ts      ← 不变
│   └── search-engine.ts       ← 不变
├── tools/
│   ├── types.ts               ← 不变
│   ├── context.ts             ← v4.5: ToolContext 扩展（可选）
│   ├── registry.ts            ← v4.2/v4.5: 集成 PromptGuard + HookManager
│   ├── permissions.ts         ← v4.1: PermissionResult 新增 riskLevel
│   ├── hook-manager.ts        ← v4.5: 新增（工具钩子管理器）
│   ├── bash.ts                ← 不变
│   ├── read.ts                ← 不变
│   ├── write.ts               ← 不变
│   └── edit.ts                ← 不变
├── utils/
│   ├── event-stream.ts        ← v4.1~v4.3: 新增审批/注入/审计事件
│   ├── token-counter.ts       ← 不变
│   └── prompt-template.ts     ← 不变
├── tests/
│   ├── test-v1.0-agent.ts     ← Phase 1
│   ├── test-v1.0-bash.ts      ← Phase 1
│   ├── test-v1.0-llm.ts       ← Phase 1
│   ├── test-v1.2-read.ts      ← Phase 2
│   ├── test-v1.3-write.ts     ← Phase 2
│   ├── test-v1.4-edit.ts      ← Phase 2
│   ├── test-v1.5-bash.ts      ← Phase 2
│   ├── test-v1.6-permissions.ts ← Phase 2
│   ├── test-v2.1-session-manager.ts ← Phase 3
│   ├── test-v2.1-session-store.ts   ← Phase 3
│   ├── test-v2.2-context-builder.ts ← Phase 3
│   ├── test-v2.3-token-counter.ts   ← Phase 3
│   ├── test-memory-manager.ts       ← Phase 4
│   ├── test-search-engine.ts        ← Phase 4
│   ├── test-approval-gateway.ts     ← v4.1 (新增)
│   ├── test-prompt-guard.ts         ← v4.2 (新增)
│   ├── test-audit-logger.ts         ← v4.3 (新增)
│   ├── test-heartbeat.ts            ← v4.4 (新增)
│   └── test-hook-manager.ts         ← v4.5 (新增)
└── index.ts                     ← v5.0: 集成全部 Phase 5 模块
```

---

## 七、安全考量

| 风险 | 缓解措施 |
|------|----------|
| 人工审批超时阻塞系统 | 设置默认 5 分钟超时，超时自动拒绝 |
| Prompt Injection 绕过 | 多规则组合检测；仅净化不阻断（避免误杀） |
| 审计日志被篡改 | 文件权限设为只追加；读取时校验格式 |
| Heartbeat 无限循环 | maxTicks 限制 + 错误计数阈值自动停止 |
| 会话分支导致存储膨胀 | GC 时清理超过 N 天的孤立分支会话 |
| Hook 执行异常 | try-catch 包裹，异常不影响主流程 |
| 审批提示被伪造 | 审批请求携带唯一 ID，resolve 时校验 ID 匹配 |
| 审计日志泄露敏感信息 | 工具输出摘要截断 500 字；敏感路径在 args 中脱敏 |

---

## 八、验证标准

Phase 5 完成后，以下场景必须工作：

```bash
# 1. 危险操作需要人工审批
> 帮我删除 build 目录
[APPROVAL REQUIRED] Tool: bash
   Risk Level: high
   Args: {"command":"rm -rf build/"}
   Type "y" to approve, "n" to deny
   > y
[Approved] Executing bash: rm -rf build/
<<< [bash] Command executed successfully.

# 2. 安全操作自动放行
> 列出当前目录文件
>>> [read_file] {"path":"./"}
<<< [read_file] src/  docs/  package.json  ...

# 3. Prompt Injection 被检测
> 读取一个可能包含恶意内容的文件
>>> [read_file] {"path":"malicious.txt"}
[System] Prompt injection detected in read_file result: system_prompt_override
<<< [read_file] [REDACTED] the content has been sanitized due to detected ...

# 4. 审计日志查询
> /audit --tool=bash --risk=high
Audit Log (3 entries):
  [1] 2026-03-29T16:00:01 bash {"command":"rm -rf build/"} high approved:user
  [2] 2026-03-29T16:05:00 bash {"command":"npm install"} medium approved:auto
  [3] 2026-03-29T16:10:00 bash {"command":"git push"} high denied:timeout

# 5. Heartbeat 自主循环
> /heartbeat start 每分钟检查测试是否通过
Heartbeat started. Interval: 60s, Max ticks: 10.
[Heartbeat] Tick #1: 2 turns, 5 tool calls
[Heartbeat] Tick #2: 1 turns, 3 tool calls
> /heartbeat stop
Heartbeat stopped. 2 ticks completed.

# 6. 会话分支
> /branch 5
Branch created: def456 (branched from abc123 at message #5)
> /resume def456
Resumed session: def456 (branched: 帮我重构代码, 5 msgs)

# 7. 工具钩子
> /hooks
Registered hooks:
  - [before] *: 0 hooks
  - [after]  *: 1 hook (audit_logger)
  - [after]  bash: 0 hooks
```

---

## 九、断点续开指南

如果会话中断，按以下步骤恢复：

1. 读取本文件：`docs/roadmap-phase5.md`
2. 查看 git log 确认当前进度：`git log --oneline`
3. 查看 git tags：`git tag -l "v4.*"`
4. 找到最新完成的版本号，继续下一个版本的实现
5. 每个版本完成后：写代码 → 跑测试 → git commit + tag → 询问用户

### 当前进度

| 版本 | 内容 | 状态 |
|------|------|------|
| v4.1.0 | 人工审批流程（ApprovalGateway） | ⏳ 待开发 |
| v4.2.0 | Prompt Injection 防护（PromptGuard） | ⏳ 待开发 |
| v4.3.0 | 审计日志（AuditLogger + AuditQuery） | ⏳ 待开发 |
| v4.4.0 | Heartbeat 自主循环 | ⏳ 待开发 |
| v4.5.0 | 会话分支 + 工具钩子 | ⏳ 待开发 |
| v5.0.0 | 全量整合 + 版本发布 | ⏳ 待开发 |

