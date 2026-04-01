# FirmClaw 技术架构介绍

> **版本**: v6.0.0
> **定位**: 本地优先的 AI 智能体框架
> **核心架构**: ReAct（Reasoning + Acting）

---

## 一、项目概述

FirmClaw 是一个从零搭建的本地优先 AI 智能体框架，核心采用 ReAct（Reasoning + Acting）架构。灵感来源于 OpenClaw，目标是实现一个**可理解、可扩展、本地运行**的智能体系统。

OpenClaw 的核心可以用一句话概括：**一个基于 ReAct 循环的 LLM 工具调用引擎**。

FirmClaw 灵魂组件按优先级排列：

| 优先级 | 组件 | 职责 |
|:---:|------|------|
| 1 | **Agent Loop（ReAct 循环）** | 绝对核心：LLM 思考 -> 调工具 -> 观察结果 -> 继续思考 |
| 2 | **工具系统** | 手和脚：极简设计（read / write / edit / bash） |
| 3 | **会话管理** | 记忆的骨架：JSONL 持久化存储 |
| 4 | **系统提示词** | 大脑的编程方式：动态组装 |
| 5 | **上下文压缩** | 生存机制：LLM 摘要 + token 裁剪 |
| 6 | **记忆系统** | 进阶能力：结构化记忆 + 全文搜索 |
| 7 | **网关层** | 扩展能力：WebSocket + 多客户端 + 子智能体 |

---

## 二、在 AI 生态中的位置

```
┌─────────────────────────────────────────────────────────┐
│                     应用 / 接口层                         │
│    CLI  │  Web UI  │  VS Code 插件  │  第三方客户端       │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│              执行 / 框架层 — FirmClaw Agent Runtime        │
│                                                         │
│  任务规划 · 工具调度 · 会话管理 · 事件分发 · 多渠道接入     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                 模型层 — 大语言模型 (LLM)                  │
│                                                         │
│  Claude · GPT · DeepSeek · MiniMax · 通义千问 · 本地模型  │
└─────────────────────────────────────────────────────────┘
```

FirmClaw 填补了**模型**与**应用**之间的空白，作为轻量级、可自部署的 Agent 运行时，负责任务规划、工具调用、记忆管理及多渠道接入。

---

## 三、整体架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      多客户端接入层                             │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐     │
│  │   CLI    │  │ Web UI   │  │ VS Code  │  │  curl / wscat│     │
│  │ (stdin)  │  │ (http)   │  │  插件    │  │  (WebSocket) │     │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └──────┬───────┘     │
└────────┼────────────┼────────────┼───────────────┼──────────────┘
        │            │            │              │
┌───────┴────────────┴────────────┴───────────────┴──────────────┐
│                                                             │
│              ┌──────────────────────────────────────┐         │
│              │        Gateway Layer（网关层）        │         │
│              │                                      │         │
│              │  ┌────────┐ ┌───────┐ ┌──────────┐  │         │
│              │  │  Auth  │ │Router │ │ConnMgr  │  │         │
│              │  │ (Token)│ │(JSON- │ │(Session  │  │         │
│              │  │        │ │ RPC)  │ │ Bind)   │  │         │
│              │  └────────┘ └───┬───┘ └──────────┘  │         │
│              └──────────────────┼─────────────────┘         │
│                                 │                            │
│  ┌──────────────┐ ┌────────────┴──────────┐ ┌─────────────┐   │
│  │  AgentLoop   │ │  SubagentManager      │ │ EventStream │   │
│  │  (ReAct 核心)│ │  (v5.3 子智能体编排)    │ │ -> WS 推送  │   │
│  │              │ │                        │ │             │   │
│  │  run()       │ │  spawn(task)           │ │ thinking_   │   │
│  │              │ │  ├─ AgentLoop #1      │ │   delta      │   │
│  │  ┌────────┐  │ │  ├─ AgentLoop #2      │ │ tool_start   │   │
│  │  │LLM思考 │  │ │  └─ merge results     │ │ tool_end     │   │
│  │  ├────────┤  │ └────────────────────────┘ │ ...         │   │
│  │  │工具调用 │  │                            └──────┬─────┘   │
│  │  ├────────┤  │                                   │          │
│  │  │观察结果 │  │  ┌────────────────────────────┴──────┐  │
│  │  └────────┘  │  │       复用的核心组件               │  │
│  └──────┬───────┘  │                                    │  │
│         │          │  LLMClient · ToolRegistry          │  │
│  ┌──────┴──────────┤  SessionManager · ContextBuilder    │  │
│  │  安全与审计层    │  Summarizer · MemoryManager        │  │
│  │                  │  SearchEngine · ApprovalGateway     │  │
│  │  ┌────────────┐ │  PromptGuard · HookManager          │  │
│  │  │ApprovalGW  │ │  Heartbeat                         │  │
│  │  │PromptGuard │ │                                    │  │
│  │  │AuditLogger │ └────────────────────────────────────┘  │
│  │  └────────────┘                                       │
│  └──────────────────────────────────────────────────────┘
```

FirmClaw 本质上是一个 **本地网关 + ReAct 循环 + 工具系统 + 持久化记忆** 的组合。这一架构模式正在成为个人 AI Agent 的标准蓝图。

---

## 四、Agent 调度层（Agent Loop — ReAct 核心）

Agent Loop 是整个 FirmClaw 系统的**心脏**。它实现了经典的 ReAct 模式，在一个 while 循环中不断进行"思考-行动-观察"。

### 4.1 ReAct 模式深度解析

| 阶段 | 描述 | 实现位置 |
|------|------|---------|
| **思考（Reason）** | LLM 分析当前任务与环境反馈，利用推理能力制定下一步行动计划 | `LLMClient.chat()` |
| **行动（Act）** | 根据思考结论，调用具体工具（搜索、读文件、执行命令）来完成任务 | `ToolRegistry.execute()` |
| **观察（Observation）** | 接收工具执行后的返回结果，作为新的上下文用于下一轮思考 | `allMessages.push(toolMsg)` |

### 4.2 典型执行流程

```
用户输入 "列出当前目录的文件"
        │
        ▼
  ┌──────────────────────┐
  │  1. 接收输入 (Input)  │  readline 读取用户输入
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │  2. 构建系统提示词     │  ContextBuilder 动态组装
  │  (Context Build)     │  SOUL.md + 工具定义 + 记忆
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │  3. 恢复历史消息       │  SessionManager 从 JSONL 加载
  │  (History Restore)   │
  └──────────┬───────────┘
             ▼
  ┌──────────────────────┐
  │  4. 上下文压缩         │  Summarizer -> TokenCounter
  │  (Context Compress)  │  LLM 摘要 + token 裁剪
  └──────────┬───────────┘
             ▼
  ╔══════ ReAct 循环开始 ═══════
             │
  ┌──────────┴───────────┐
  │ 5. LLM 推理           │  调用 LLM API（流式输出）
  │    → 返回 tool_calls   │  "需要执行 bash ls 命令"
  └──────────┬───────────┘
             ▼
  ┌──────────┴───────────┐
  │ 6. 工具调用 (Action)   │  权限检查 → 参数校验 → 执行
  │    bash { command: ls }│  返回目录列表
  └──────────┬───────────┘
             ▼
  ┌──────────┴───────────┐
  │ 7. 观察 (Observation) │  将工具结果加入消息历史
  │    → LLM 继续推理     │  LLM 决定：任务完成
  └──────────┬───────────┘
             ▼
  ┌──────────┴───────────┐
  │ 8. 最终回复 (Output)   │  "当前目录包含以下文件..."
  └──────────────────────┘
```

### 4.3 关键特性

- **自主循环**：ReAct 循环通过"思考-行动-观察"不断迭代，处理复杂的不确定性任务
- **可解释性**：每一轮的思考过程通过 `thinking_delta` 事件实时输出
- **错误自我修正**：通过观察执行结果，LLM 能发现行动偏差并主动调整策略
- **安全控制**：危险操作（如 `rm -rf`）会在执行前暂停等待人工审批

---

## 五、工具层（Tool System）

工具层是 Agent 的"手脚"，决定了实际操作能力。

### 5.1 四个核心工具

| 工具 | 功能 | 关键设计 |
|------|------|---------|
| **bash** | 执行终端命令 | `spawn()` 实现流式输出，支持 cwd/timeout，超时 SIGTERM |
| **read_file** | 读取文件内容 | 支持 offset/limit 分段读取，二进制检测，带行号输出 |
| **write_file** | 创建/覆写文件 | 自动创建父目录，输出写入字节数 |
| **edit_file** | 精确编辑文件 | 查找替换，**唯一性校验**（old_str 必须只出现一次） |

### 5.2 工具注册与执行流程

```
LLM 发起工具调用
        │
        ▼
  ┌────────────────────────────┐
  │ ToolRegistry.execute()      │
  │                            │
  │  1. ajv 参数校验           │  JSON Schema 验证
  │  2. Before Hooks           │  可修改参数或拒绝执行
  │  3. 权限检查               │  路径白名单 + 命令黑名单 + 风险评估
  │  4. 人工审批（可选）        │  高风险操作暂停等待用户确认
  │  5. 工具执行               │  实际调用 bash/read/write/edit
  │  6. After Hooks            │  审计日志、结果处理
  │  7. Prompt Injection 防护   │  扫描返回结果中的注入攻击
  └────────────┬───────────────┘
               │
               ▼
         工具执行结果
```

### 5.3 权限策略

| 操作类型 | 风险等级 | 处理方式 |
|---------|---------|---------|
| `read_file` | low | 自动放行 |
| `bash`（只读命令：`ls`, `git status`） | low | 自动放行 |
| `write_file`（新文件） | medium | 按 risk-based 模式决定 |
| `edit_file` | medium | 按 risk-based 模式决定 |
| `bash`（删除命令：`rm`, `del`） | high | 需人工审批 |
| `bash`（写入/安装命令：`npm install`） | medium | 按 risk-based 模式决定 |

---

## 六、大模型层（LLM Client）

LLM Client 是与 LLM API 通信的封装层，采用 **OpenAI 兼容格式**，通过统一接口适配多个模型提供商。

### 6.1 兼容的模型提供商

| 类型 | 推荐模型 | 特点 |
|------|---------|------|
| **云端 API** | MiniMax M2.7 / DeepSeek / Kimi / 通义千问 / Claude / GPT | 性能强，即开即用，有 token 费用 |
| **本地私有** | Ollama + Qwen3.5-32B / DeepSeek | 数据隐私，零 token 成本，离线可用 |
| **混合调度** | 简单任务本地，复杂任务云端 | 智能路由，性能与成本平衡 |

### 6.2 核心设计

```typescript
// 统一的 Message 接口
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;      // tool 角色关联到工具调用
  tool_calls?: ToolCall[];     // assistant 角色携带的工具调用列表
}

// LLMClient 核心方法
class LLMClient {
  // 发送消息，支持流式输出
  async chat(messages, tools, onDelta?): Promise<Message>;
}
```

**切换模型只需改配置，不需要改代码**——所有模型提供商统一使用 OpenAI Chat Completions API 格式。

---

## 七、记忆系统（Memory System）

记忆系统是 FirmClaw 架构中最具特色的设计，采用 **文件为真实来源、结构化管理、全文索引加速** 的混合方案。

### 7.1 工作区文件结构

```
workspace/
└── .firmclaw/
    ├── SOUL.md       ← 灵魂文件：定义 Agent 的人格和行为准则
    ├── AGENTS.md     ← 协作配置：定义多智能体协作规则
    └── MEMORY.md     ← 长期记忆：结构化的跨会话记忆
```

### 7.2 记忆管理系统

MEMORY.md 采用结构化 Markdown 格式：

```markdown
# 长期记忆

## 偏好
- [P001] 用户偏好 pnpm 而非 npm (2026-03-28)

## 技术决策
- [T001] 项目使用 TypeScript strict 模式 (2026-03-28)

## 待办
- [D001] 实现向量搜索模块 (2026-03-28)

## 知识
- [K001] FirmClaw 使用 ReAct 架构 (2026-03-28)
```

每条记忆包含：
- **ID**：`[TAG + 三位数字]`，如 `[P001]`、`[T002]`
- **内容**：一行简洁描述
- **时间戳**：`(YYYY-MM-DD)`

### 7.3 全文搜索引擎

纯 JS 实现 **BM25 算法**（不引入 SQLite 等原生依赖）：

| 检索方式 | 实现 | 用途 |
|---------|------|------|
| 关键词匹配 | BM25 + 中文 bigram 分词 | 精确匹配专有名词 |
| 记忆注入 | 搜索结果动态注入系统提示词 | 每次对话自动检索相关记忆 |
| 跨会话 | 索引覆盖会话消息 + 记忆条目 | 不同会话间的信息引用 |

### 7.4 记忆检索流程

```
用户输入 "帮我继续之前的项目开发"
        │
        ▼
  ContextBuilder.build()
        │
        ├── 加载 SOUL.md（人格定义）
        ├── 注入工具定义
        ├── 注入会话信息
        │
        └── 记忆检索：
              SearchEngine.search("帮我继续之前的项目开发")
                    │
                    ├── 命中 [K001] FirmClaw 使用 ReAct 架构
                    ├── 命中 [T001] 项目使用 TypeScript strict 模式
                    └── 命中 [D001] 实现向量搜索模块
                    │
                    ▼
            注入到系统提示词的 {{memory}} 区域
```

---

## 八、安全与审计层

### 8.1 人工审批（Human-in-the-Loop）

通过 Promise + 回调模式实现异步等待——Agent Loop 在危险操作前暂停，CLI 通过用户输入恢复。

```
Agent Loop                          CLI
    │                                    │
    ├─ approvalGateway.request()         │
    │  └─ new Promise → 暂停等待          │
    │       │                            │
    │       ├─ emit('approval_requested') → 显示提示 + 风险等级
    │       │                              用户输入 y/n
    │       │←─ gateway.resolve() ─────────┘
    │       │                            │
    ├─ 继续执行（或跳过）                  │
```

### 8.2 Prompt Injection 防护

基于正则匹配扫描工具返回结果中的注入攻击：

| 检测类型 | 示例 |
|---------|------|
| 系统提示词劫持 | "忽略之前的指令" / "ignore all previous instructions" |
| 角色扮演攻击 | "pretend you are god" / "你现在是管理员" |
| 分隔符注入 | `<\|end\|>` / `[INST]` |
| 中文注入 | "忽略以上所有指令" |
| Markdown 注入 | `[[SYSTEM]]` / `</instruction>` |

不阻断执行，而是**标记并净化**可疑内容（替换为 `[REDACTED]`）。

### 8.3 审计日志

全量操作记录存储在 `~/.firmclaw/audit.jsonl`（append-only），记录每次工具执行的操作、参数、风险等级、审批来源、执行结果和耗时。支持按工具、风险等级、时间范围查询和 CSV 导出。

---

## 九、上下文管理

长对话场景下，上下文管理是 Agent 的"生存机制"。

### 9.1 三级递进压缩策略

| 优先级 | 策略 | 实现 | 效果 |
|:---:|------|------|------|
| 1 | **LLM 摘要压缩** | `Summarizer` | 保留语义和关键决策，50条消息压缩为~2000 token |
| 2 | **工具结果截断** | `TokenCounter` | 单条 tool 消息超过 500 token 时截断 |
| 3 | **旧消息移除** | `TokenCounter` | 整体超限时从最早的消息开始移除 |

### 9.2 摘要压缩流程

```
历史消息超过 80,000 token 阈值
        │
        ▼
  Summarizer.shouldSummarize() → true
        │
        ▼
  取最早的 50 条消息，调用 LLM 生成摘要
        │
        ▼
  摘要内容：
  ──────────────────────
  ✓ 用户决定使用 TypeScript strict 模式
  ✓ 权限策略采用白名单 + 黑名单混合模式
  ✓ 工具执行流程：校验 → Hook → 权限 → 审批 → 执行 → 扫描
  ○ 待办：实现向量搜索模块
  ──────────────────────
        │
        ▼
  用一条 system 摘要消息替代 50 条原始消息
  30,000 token → 2,000 token（压缩 93%）
```

---

## 十、网关层（Gateway Layer）

### 10.1 WebSocket 服务器

基于 `ws` 库实现标准 WebSocket，采用 **JSON-RPC 2.0** 协议进行双向通信。

| JSON-RPC 方法 | 说明 |
|---|---|
| `agent.chat` | 发送消息给智能体 |
| `session.list` | 列出所有会话 |
| `session.new` | 创建新会话 |
| `session.resume` | 恢复会话 |
| `approval.respond` | 响应审批请求 |
| `agent.cancel` | 取消当前执行 |

### 10.2 事件推送

AgentLoop 的所有事件通过 EventStream 自动转发为 JSON-RPC notification：

| Agent 事件 | WebSocket 推送 | 说明 |
|-----------|--------------|------|
| `thinking_delta` | `agent.thinking` | LLM 实时思考内容 |
| `tool_start` | `agent.tool_start` | 工具开始执行 |
| `tool_end` | `agent.tool_end` | 工具执行完成 |
| `approval_requested` | `agent.approval_requested` | 等待人工审批 |

### 10.3 子智能体（Subagent）

主智能体可将复杂任务拆分给子智能体并行执行：

```
主 AgentLoop                      子智能体 #1                 子智能体 #2
    │                                │                          │
    ├─ LLM: "同时分析两个文件"       │                          │
    │                                │                          │
    ├─ tool_call: subagent_run      │                          │
    ├─ SubagentManager.spawn() ─────┤                          │
    │                               ├─ AgentLoop (独立实例)      │
    │                               ├─ run("分析 auth.ts")     │
    │                               └─ return result ───────────┤
    │                                                          │
    ├─ tool_call: subagent_run                                 │
    ├─ SubagentManager.spawn() ───────────────────────────────┤
    │                                                          │
    │                               ├─ AgentLoop (独立实例)      │
    │                               ├─ run("分析 api.ts")      │
    │                               └─ return result ───────────┤
    │                                                          │
    ├─ 合并结果 → LLM 综合回答                                │
    └─ final response
```

**安全隔离**：子智能体默认只读（`allowedTools` 白名单），不共享父会话的审批状态，受 `maxSubagents` 和 `timeoutMs` 双重限制。

---

## 十一、技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript + Node.js | 生态丰富，OpenClaw 同款 |
| LLM 接入 | OpenAI 兼容 SDK（`openai`） | 一套代码适配所有模型提供商 |
| 包管理 | npm | 项目依赖少，无需 pnpm 的 workspace 特性 |
| 存储 | JSONL 文件 | 本地优先，append-only，天然支持追加写入 |
| 参数校验 | ajv | 工具参数 JSON Schema 校验 |
| 实时通信 | ws | 轻量标准 WebSocket 库 |
| 全文搜索 | 纯 JS BM25 | 零原生依赖，倒排索引 + JSON 持久化 |
| 安全 | 正则匹配 + 权限策略 | 零成本 Prompt Injection 防护 |

**外部依赖仅 6 个**：`openai`、`ajv`、`dotenv`、`tsx`、`typescript`、`ws`

---

## 十二、项目源码结构

```
src/
├── agent/                 ← ReAct 循环 + 安全 + 子智能体
│   ├── agent-loop.ts       ReAct 循环核心（系统的心脏）
│   ├── types.ts            AgentConfig / AgentResult 类型
│   ├── approval-gateway.ts 人工审批网关（Promise + 回调）
│   ├── prompt-guard.ts     Prompt Injection 防护
│   ├── heartbeat.ts        Heartbeat 自主循环
│   └── subagent-manager.ts 子智能体管理器
│
├── tools/                 ← 工具系统
│   ├── types.ts            Tool / ToolResult 接口
│   ├── registry.ts         工具注册中心（校验 + 执行 + 钩子）
│   ├── bash.ts             终端命令执行
│   ├── read.ts             文件读取
│   ├── write.ts            文件写入
│   ├── edit.ts             文件编辑（唯一性校验）
│   ├── permissions.ts      权限策略（路径白名单 + 命令黑名单）
│   ├── context.ts          ToolContext 工具执行上下文
│   ├── hook-manager.ts     工具执行钩子（before/after）
│   └── subagent.ts         子智能体工具定义
│
├── session/               ← 会话管理 + 记忆 + 搜索
│   ├── types.ts            SessionMeta / StoredMessage 类型
│   ├── store.ts            JSONL 存储层
│   ├── manager.ts          会话管理器（create / resume / branch）
│   ├── context-builder.ts  系统提示词动态组装器
│   ├── summarizer.ts       LLM 摘要压缩器
│   ├── memory-manager.ts   结构化记忆管理
│   └── search-engine.ts    BM25 全文搜索引擎
│
├── gateway/               ← WebSocket 网关
│   ├── types.ts            JSON-RPC 类型定义
│   ├── server.ts           WebSocket 服务器
│   ├── connection.ts       连接管理器
│   ├── router.ts           消息路由器
│   ├── auth.ts             Token 认证
│   └── web-ui.ts           Web UI 页面
│
├── audit/                 ← 审计日志
│   ├── types.ts            审计类型定义
│   ├── logger.ts           审计记录器
│   └── query.ts            审计查询器
│
├── cli/                   ← CLI 交互
│   ├── renderer.ts         富文本渲染器
│   └── progress.ts         进度指示器
│
├── utils/                 ← 基础设施
│   ├── event-stream.ts      事件流（EventEmitter 封装）
│   ├── token-counter.ts    Token 估算 + 消息裁剪
│   └── prompt-template.ts  简单模板引擎（{{}} 语法）
│
├── tests/                 ← 测试（26 个测试文件）
│   └── ...                 覆盖所有核心模块
│
└── index.ts                ← 程序入口（组件组装 + CLI 循环）
```

---

## 十三、开发历程

FirmClaw 历经 6 个开发阶段，从最小可用的 ReAct 循环逐步演进为功能完备的智能体平台。

| 阶段 | 版本 | 目标 | 状态 |
|------|------|------|------|
| Phase 1 | v1.0 | 最小可用的 ReAct 循环 | ✅ 完成 |
| Phase 2 | v1.6 | 完善工具系统（4 工具 + 权限） | ✅ 完成 |
| Phase 3 | v2.4 | 会话管理 + 系统提示词 + 上下文窗口 | ✅ 完成 |
| Phase 4 | v3.4 | LLM 摘要 + 记忆系统 + 全文搜索 | ✅ 完成 |
| Phase 5 | v5.0 | 安全与进阶特性（审批 + 审计 + 心跳 + 分支 + 钩子） | ✅ 完成 |
| Phase 6 | v6.0 | 网关与多平台适配（WebSocket + 子智能体 + Web UI） | ✅ 完成 |

---

## 十四、总结

FirmClaw 的核心架构可以概括为：

> **一个基于 ReAct 循环的 LLM 工具调用引擎，以本地网关 + 工具系统 + 持久化记忆的组合作为标准蓝图。**

从 Driver（驾驶员）变成 Manager（管理者），FirmClaw 让用户能够将重复性任务交给自主 Agent 执行，实现从"对话式交互"到"自主行动"的跨越。

通过 **渐进式架构设计**（6 个阶段逐步叠加功能）、**零外部依赖策略**（核心功能仅依赖 Node.js 内置模块）和 **全面的安全机制**（权限策略 + 人工审批 + 注入防护 + 审计日志），FirmClaw 在保持极简设计的同时，达到了生产级的可靠性和安全性。
