# OpenClaw 底层实现原理与 ReAct 智能体架构深度解析

## 快速概览

**OpenClaw** 是一个开源的本地优先 AI 智能体框架，由 Peter Steinberger 于 2025 年底创建，迅速成为 GitHub 上最受欢迎的 AI 智能体项目之一（超过 24.7 万星标）。其核心设计理念是将大型语言模型（LLM）的自然语言理解能力与本地操作系统的执行权限深度结合，实现跨文件系统、终端命令行、浏览器和第三方即时通讯平台的多维自动化操作。

OpenClaw 的核心创新在于采用了 **ReAct（Reasoning + Acting）框架**，这是一个由 Shunyu Yao 等人在 2022 年提出的智能体架构，将**推理（Reasoning）**与**行动（Acting）**有机结合，使智能体能够在与外部工具交互的过程中进行多步骤推理，动态调整策略，最终完成复杂任务。

本报告将深入剖析 OpenClaw 的底层实现原理，拆解其核心代码，并详细介绍 ReAct 智能体的实现机制。

---

## 1. OpenClaw 整体架构概览

### 1.1 核心组件分层

OpenClaw 的架构可以分为五个核心层次，每个层次承担不同的职责，协同工作实现智能体的完整功能：

| 层次 | 组件 | 核心职责 | 关键技术 |
|------|------|----------|----------|
| **L1: 网关层 (Gateway)** | WebSocket Server | 消息路由、会话管理、平台连接 | WebSocket 持久连接、多路复用 |
| **L2: 智能体运行时 (Agent Runtime)** | Pi Agent Core | ReAct 循环执行、工具调用、流式响应 | ReAct 框架、EventStream |
| **L3: 工具层 (Tools)** | read/write/edit/bash 等 | 文件操作、命令执行、浏览器控制 | 沙箱隔离、权限策略 |
| **L4: 记忆系统 (Memory)** | SQLite + FTS5 + Vector | 短期/长期记忆、混合检索 | BM25 + 向量相似度、混合搜索 |
| **L5: 技能系统 (Skills)** | SKILL.md + ClawHub | 能力扩展、知识注入、插件生态 | Markdown  frontmatter、版本控制 |

*表 1: OpenClaw 核心架构分层*

### 1.2 数据流向全景

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           用户交互层 (Messaging Channels)                      │
│  WhatsApp │ Telegram │ Slack │ Discord │ Signal │ iMessage │ Web │ ...      │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           网关层 (Gateway)                                    │
│  • WebSocket 服务器 (127.0.0.1:18789)                                        │
│  • 消息路由与会话解析 (sessionKey → agentId + channel + user)                │
│  • 多平台协议适配 (Channel Layer)                                            │
│  • 认证与授权 (Token-based, Challenge-Response)                              │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        智能体运行时 (Agent Runtime)                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ReAct 循环 (Thought → Action → Observation)                         │   │
│  │  • 系统提示词组装 (System Prompt Assembly)                           │   │
│  │  • LLM 调用 (Model Inference)                                        │   │
│  │  • 工具解析与执行 (Tool Parsing & Execution)                         │   │
│  │  • 流式响应 (Streaming Response)                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
┌─────────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   工具层 (Tools)     │ │  记忆系统        │ │  技能系统        │
│  • read/write/edit  │ │  • SQLite FTS5  │ │  • SKILL.md     │
│  • bash/exec        │ │  • Vector Search│ │  • ClawHub      │
│  • browser          │ │  • Hybrid Search│ │  • Extensions   │
└─────────────────────┘ └─────────────────┘ └─────────────────┘
```

*图 1: OpenClaw 数据流向全景图*

### 1.3 关键设计哲学

OpenClaw 的设计体现了几个核心哲学：

1. **本地优先 (Local-First)**: 所有数据存储在本地，不依赖云服务，确保隐私和可控性
2. **Markdown 作为真相源 (Markdown as Source of Truth)**: 所有持久化数据（记忆、配置、技能）都以纯 Markdown 文件形式存储，人类可读、可编辑、可版本控制
3. **极简工具集 (Minimal Toolset)**: 核心仅提供 4 个工具（read、write、edit、bash），智能体通过编写代码来解决具体问题
4. **双层循环架构 (Dual-Loop Architecture)**: 外层循环处理多轮对话和 follow-up，内层循环处理单轮内的工具调用和推理

---

## 2. ReAct 智能体框架深度解析

### 2.1 ReAct 的核心理念

**ReAct（Reasoning + Acting）** 是由普林斯顿大学和 Google Research 的研究人员在 2022 年提出的智能体框架，其核心思想是将**推理（Reasoning）**和**行动（Acting）**紧密结合，使大语言模型能够在与外部环境交互的过程中进行多步骤推理。

传统的大语言模型应用通常是单轮的：用户输入 → 模型生成 → 输出响应。而 ReAct 框架引入了**迭代循环**，使模型能够：

1. **思考 (Thought)**: 分析当前状态，决定下一步行动
2. **行动 (Action)**: 调用外部工具（搜索、执行命令、读取文件等）
3. **观察 (Observation)**: 获取工具执行结果
4. **循环**: 基于观察结果重新思考，直到任务完成

### 2.2 ReAct 的工作循环

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ReAct 循环 (The ReAct Loop)                           │
│                                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │  Thought │───▶│  Action  │───▶│Observation│───▶│  Thought │───▶ ...     │
│   │  (思考)  │    │  (行动)  │    │  (观察)   │    │ (再思考) │             │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘             │
│        │               │               │               │                   │
│        ▼               ▼               ▼               ▼                   │
│   "我需要搜索    "调用 web_search    "搜索结果显示    "基于结果，          │
│    最新信息"      工具查询信息"      了 X、Y、Z"      我应该调用..."        │
│                                                                              │
│   循环终止条件：                                                              │
│   • 模型生成最终答案（无工具调用）                                            │
│   • 达到最大迭代次数                                                          │
│   • 用户中断或超时                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 2: ReAct 循环的工作流程*

### 2.3 ReAct 与 Chain-of-Thought 的对比

| 特性 | Chain-of-Thought (CoT) | ReAct |
|------|------------------------|-------|
| **核心机制** | 仅推理，无外部交互 | 推理 + 行动 + 观察 |
| **信息来源** | 依赖模型内部知识 | 可实时获取外部信息 |
| **准确性** | 易产生幻觉 | 通过观察验证，减少幻觉 |
| **适用场景** | 数学推理、逻辑推理 | 需要实时信息的任务 |
| **交互方式** | 单轮生成 | 多轮迭代 |
| **可解释性** | 中等（可见推理过程） | 高（可见完整行动链） |

*表 2: ReAct 与 Chain-of-Thought 的对比*

### 2.4 ReAct 的 prompt 格式

ReAct 的 prompt 通常采用以下格式，包含 few-shot 示例：

```
Solve a question answering task with interleaving Thought, Action, Observation steps.
Thought can reason about the current situation, and Action can be three types: 
(1) Search[entity], which searches the exact entity on Wikipedia and returns the first paragraph if it exists. If not, it will return some similar entities to search.
(2) Lookup[keyword], which returns the next sentence containing keyword in the current passage.
(3) Finish[answer], which returns the answer and finishes the task.

Here are some examples.

Question: What is the elevation range for the area that the eastern sector of the Colorado orogeny extends into?
Thought 1: I need to search Colorado orogeny, find the area that the eastern sector of the Colorado orogeny extends into, then find the elevation range of the area.
Action 1: Search[Colorado orogeny]
Observation 1: The Colorado orogeny was an episode of mountain building (an orogeny) in Colorado and surrounding areas.
Thought 2: It does not mention the eastern sector. So I need to look up eastern sector.
Action 2: Lookup[eastern sector]
Observation 2: The eastern sector extends into the High Plains and is called the Central Plains orogeny.
Thought 3: The eastern sector of Colorado orogeny extends into the High Plains. So I need to search High Plains and find its elevation range.
Action 3: Search[High Plains]
Observation 3: High Plains refers to one of two distinct land regions: High Plains (United States), High Plains (Australia).
Thought 4: I need to search High Plains (United States) to find the elevation range.
Action 4: Search[High Plains (United States)]
Observation 4: The High Plains are a subregion of the Great Plains. From east to west, the High Plains rise in elevation from around 1,800 to 7,000 ft.
Thought 5: High Plains rise in elevation from around 1,800 to 7,000 ft, so the answer is 1,800 to 7,000 ft.
Action 5: Finish[1,800 to 7,000 ft]

Question: {question}
```

*代码示例 1: ReAct 的 few-shot prompt 格式*

---

## 3. OpenClaw 的核心实现拆解

### 3.1 Agent Loop: 双层循环架构

OpenClaw 的 Agent Loop 是其最核心的组件，采用了**双层循环架构**来处理复杂的交互场景：

```typescript
// agent-loop.ts — 双层循环 + EventStream 实现
function runAgentLoop(params: AgentLoopParams): EventStream<MiniAgentEvent, MiniAgentResult> {
  const stream = createMiniAgentStream();

  (async () => {
    // ========== 外层循环: Follow-up 循环 ==========
    // 处理 end_turn / tool_use 继续的场景
    while (outerTurn < maxOuterTurns) {
      
      // ========== 内层循环: 工具执行 + Steering Injection ==========
      while (innerTurn < maxInnerTurns) {
        // 1. 构建上下文（系统提示词 + 历史对话 + 工具列表）
        const context = await buildContext(params);
        
        // 2. 调用 LLM
        const response = await callLLM(context);
        
        // 3. 解析响应
        if (response.type === 'text') {
          // 生成文本响应，流式推送给用户
          stream.push({ type: 'message_delta', delta: response.text });
          break; // 内层循环结束
        } 
        else if (response.type === 'tool_call') {
          // 4. 执行工具
          stream.push({ 
            type: 'tool_execution_start', 
            toolName: response.toolName, 
            args: response.args 
          });
          
          const result = await executeTool(response.toolName, response.args);
          
          stream.push({ 
            type: 'tool_execution_end', 
            toolName: response.toolName, 
            result 
          });
          
          // 5. 将工具结果加入上下文，继续内层循环
          context.addToolResult(result);
        }
        
        // 6. 检查 steering injection（用户中断、新消息等）
        if (hasSteeringInjection()) {
          handleSteeringInjection();
        }
      }
      
      // 检查是否需要 follow-up（例如工具执行后需要进一步推理）
      if (needsFollowUp()) {
        continue; // 外层循环继续
      } else {
        break; // 外层循环结束
      }
    }
    
    stream.end({ text: finalText, turns, toolCalls });
  })();

  return stream; // 调用方通过 for-await 消费事件流
}
```

*代码示例 2: OpenClaw 的双层循环架构（简化版）*

#### 3.1.1 外层循环 (Outer Loop)

外层循环处理**跨轮次**的复杂场景：

- **Follow-up 处理**: 当模型生成 `end_turn` 后，如果工具执行结果表明需要进一步推理，外层循环会继续
- **多轮工具调用**: 一个复杂任务可能需要多轮工具调用才能完成
- **上下文管理**: 每轮循环都会更新上下文，确保模型看到完整的执行历史

#### 3.1.2 内层循环 (Inner Loop)

内层循环处理**单轮内**的工具调用和推理：

- **工具执行**: 解析模型的工具调用请求，执行相应工具
- **结果反馈**: 将工具执行结果反馈给模型
- **Steering Injection**: 处理用户中断、新消息注入等实时事件

#### 3.1.3 EventStream 事件流

OpenClaw 使用 **EventStream** 模式来实现异步事件推送：

```typescript
// 事件类型定义
interface MiniAgentEvent {
  type: 'message_delta' | 'thinking_delta' | 'tool_execution_start' | 
        'tool_execution_end' | 'agent_error' | 'turn_start' | 'turn_end';
  // ... 其他字段
}

// 订阅事件
const unsubscribe = agent.subscribe((event) => {
  switch (event.type) {
    case 'thinking_delta':
      // 流式思考过程
      process.stdout.write(event.delta);
      break;
    case 'message_delta':
      // 流式文本响应
      process.stdout.write(event.delta);
      break;
    case 'tool_execution_start':
      // 工具开始执行
      console.log(`[${event.toolName}]`, event.args);
      break;
    case 'tool_execution_end':
      // 工具执行完成
      console.log(`✓ ${event.toolName}`);
      break;
  }
});

// 运行智能体
const result = await agent.run(sessionKey, "列出当前目录的文件");
console.log(`${result.turns} 轮, ${result.toolCalls} 次工具调用`);

// 取消订阅
unsubscribe();
```

*代码示例 3: EventStream 事件订阅模式*

### 3.2 系统提示词组装 (System Prompt Assembly)

OpenClaw 的系统提示词不是静态字符串，而是**动态组装**的，包含多个层次：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        系统提示词组装流程                                      │
│                                                                              │
│  STEP 1: 加载框架核心                                                         │
│    • OpenClaw 核心框架代码                                                    │
│    • Context Header                                                           │
│    • Tool Call Style（工具调用格式规范）                                       │
│    • Safety Rules（安全规则）                                                 │
│                                                                              │
│  STEP 2: 扫描并加载 Tools                                                     │
│    • 扫描 src/tools/ 目录                                                     │
│    • 读取每个工具的 TypeScript 定义                                           │
│    • 生成 JSON Schema                                                         │
│    • 按类别分组                                                               │
│                                                                              │
│  STEP 3: 扫描并加载 Skills                                                    │
│    • 扫描 ~/openclaw/skills/ 目录                                             │
│    • 读取每个 skill 的 SKILL.md                                               │
│    • 提取 name / description / location                                       │
│    • 生成 Available Skills 表格                                               │
│                                                                              │
│  STEP 4: 加载 Model Aliases                                                   │
│    • 读取 ~/.openclaw/agents/{agent}/agent/models.json                        │
│    • 解析 model mappings                                                      │
│    • 生成 Model Aliases 列表                                                  │
│                                                                              │
│  STEP 5: 注入协议规范                                                         │
│    • Silent Replies 规范                                                      │
│    • Heartbeats 协议                                                          │
│    • Chunked Write Protocol                                                   │
│    • Reply Tags 规范                                                          │
│                                                                              │
│  STEP 6: 注入运行时信息                                                       │
│    • 当前时间戳                                                               │
│    • Agent/Host/OS/Node 信息                                                  │
│    • Model/Default Model 信息                                                 │
│    • Channel/Capabilities 信息                                                │
│                                                                              │
│  STEP 7: 加载 Workspace Files（用户可编辑）★                                  │
│    • IDENTITY.md（智能体身份）                                                │
│    • SOUL.md（人格、价值观、边界）                                            │
│    • USER.md（用户信息、偏好）                                                │
│    • AGENTS.md（操作手册、安全规则、工作流）                                  │
│    • HEARTBEAT.md（周期性任务清单）                                           │
│    • TOOLS.md（本地工具说明）                                                 │
│    • MEMORY.md（长期记忆）                                                    │
│                                                                              │
│  STEP 8: 执行 Bootstrap Hook System（用户可编程）★                            │
│    • 触发 agent:bootstrap Hook                                                │
│    • 触发 bootstrap-extra-files Hook                                          │
│    • 应用 bootstrapMaxChars 预算控制                                          │
│    • 触发 before_prompt_build Hook                                            │
│                                                                              │
│  STEP 9: 注入 Inbound Context                                                 │
│    • 解析 Message Metadata                                                    │
│    • 解析 Sender Info                                                         │
│    • 解析 Chat History                                                        │
│    • 解析其他上下文                                                           │
│                                                                              │
│  FINAL: 组装完成                                                              │
│    • 总大小：~43KB                                                            │
│    • 用户可控部分：~14-17KB（Layer 7 + 8）                                     │
│    • 框架生成部分：~26-29KB（Layer 1-6, 9）                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 3: OpenClaw 系统提示词组装流程*

#### 3.2.1 核心系统提示词结构

```typescript
// src/agents/system-prompt.ts
export function buildAgentSystemPrompt(params: SystemPromptParams): string {
  const sections: string[] = [];
  
  // 1. 基础身份
  sections.push(buildBaseIdentity(params));
  
  // 2. 工具列表
  sections.push(buildToolingSection(params.tools));
  
  // 3. 安全规则
  sections.push(buildSafetySection());
  
  // 4. 技能列表
  sections.push(buildSkillsSection(params.skills));
  
  // 5. 自更新说明
  sections.push(buildSelfUpdateSection());
  
  // 6. 工作区信息
  sections.push(buildWorkspaceSection(params.workspace));
  
  // 7. 文档引用
  sections.push(buildDocumentationSection());
  
  // 8. 沙箱信息（如果启用）
  if (params.sandbox.enabled) {
    sections.push(buildSandboxSection(params.sandbox));
  }
  
  // 9. 当前日期时间
  sections.push(buildDateTimeSection(params.timezone));
  
  // 10. 回复标签
  sections.push(buildReplyTagsSection());
  
  // 11. Heartbeat 协议
  sections.push(buildHeartbeatSection());
  
  // 12. 运行时元数据
  sections.push(buildRuntimeSection(params.runtime));
  
  // 13. 推理级别
  sections.push(buildReasoningSection(params.reasoningLevel));
  
  // 14. 注入 Workspace Files
  sections.push(buildWorkspaceFilesSection(params.workspaceFiles));
  
  return sections.join('\n\n');
}
```

*代码示例 4: 系统提示词构建函数*

#### 3.2.2 Workspace Files 详解

Workspace Files 是用户可编辑的 Markdown 文件，用于定义智能体的行为：

| 文件 | 用途 | 示例内容 |
|------|------|----------|
| **IDENTITY.md** | 智能体身份、名称、语气 | "You are Claw, a helpful AI assistant..." |
| **SOUL.md** | 人格、价值观、行为边界 | "Core Truths: Be genuinely helpful..." |
| **USER.md** | 用户信息、偏好、背景 | "User's name is Alice. She prefers concise answers..." |
| **AGENTS.md** | 操作手册、安全规则、工作流 | "Always verify before deleting files..." |
| **HEARTBEAT.md** | 周期性任务清单 | "Every 30min: Check email, Summarize news..." |
| **TOOLS.md** | 本地工具说明 | "Use read tool for files < 100KB..." |
| **MEMORY.md** | 长期记忆（由智能体维护） | "Alice is working on Project X..." |

*表 3: Workspace Files 说明*

### 3.3 工具系统 (Tools System)

OpenClaw 的核心工具集非常精简，仅包含 4 个基础工具：

```typescript
// src/tools/core-tools.ts
export const coreTools: AgentTool[] = [
  {
    name: 'read',
    description: 'Read file contents from the local filesystem',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative file path' }),
      offset: Type.Optional(Type.Number({ description: 'Start reading from this line' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum lines to read' })),
    }),
    execute: async (id, params, signal, onUpdate) => {
      const content = await fs.readFile(params.path, 'utf-8');
      const lines = content.split('\n');
      const start = params.offset || 0;
      const end = params.limit ? start + params.limit : lines.length;
      return {
        content: [{ type: 'text', text: lines.slice(start, end).join('\n') }],
        details: { totalLines: lines.length, readLines: end - start },
      };
    },
  },
  
  {
    name: 'write',
    description: 'Write content to a file on the local filesystem',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute or relative file path' }),
      content: Type.String({ description: 'Content to write' }),
    }),
    execute: async (id, params, signal, onUpdate) => {
      await fs.writeFile(params.path, params.content, 'utf-8');
      return {
        content: [{ type: 'text', text: `File written: ${params.path}` }],
        details: { bytesWritten: params.content.length },
      };
    },
  },
  
  {
    name: 'edit',
    description: 'Edit a file by replacing specific content',
    parameters: Type.Object({
      path: Type.String({ description: 'File path' }),
      oldString: Type.String({ description: 'Text to replace' }),
      newString: Type.String({ description: 'Replacement text' }),
    }),
    execute: async (id, params, signal, onUpdate) => {
      const content = await fs.readFile(params.path, 'utf-8');
      const newContent = content.replace(params.oldString, params.newString);
      await fs.writeFile(params.path, newContent, 'utf-8');
      return {
        content: [{ type: 'text', text: `File edited: ${params.path}` }],
        details: { replacements: 1 },
      };
    },
  },
  
  {
    name: 'bash',
    description: 'Execute bash commands in the workspace',
    parameters: Type.Object({
      command: Type.String({ description: 'Bash command to execute' }),
      timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' })),
    }),
    execute: async (id, params, signal, onUpdate) => {
      const { stdout, stderr } = await execAsync(params.command, {
        timeout: params.timeout || 60000,
        cwd: workspaceDir,
      });
      return {
        content: [
          { type: 'text', text: stdout },
          ...(stderr ? [{ type: 'text', text: `\n[stderr]\n${stderr}` }] : []),
        ],
        details: { exitCode: 0 },
      };
    },
  },
];
```

*代码示例 5: OpenClaw 核心工具集*

#### 3.3.1 工具执行流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具执行流程                                         │
│                                                                              │
│  1. 模型生成工具调用请求                                                      │
│     {                                                                        │
│       "tool": "read",                                                        │
│       "params": { "path": "/home/user/project/README.md" }                   │
│     }                                                                        │
│                              │                                               │
│                              ▼                                               │
│  2. 解析工具调用                                                              │
│     • 验证工具名称是否存在                                                    │
│     • 验证参数是否符合 JSON Schema                                            │
│     • 检查工具权限策略（allowlist/denylist）                                  │
│                              │                                               │
│                              ▼                                               │
│  3. 执行前钩子（Before Tool Hook）                                            │
│     • 触发 before_tool_call 插件钩子                                          │
│     • 执行审批流程（如果启用）                                                │
│     • 记录审计日志                                                            │
│                              │                                               │
│                              ▼                                               │
│  4. 执行工具                                                                  │
│     • 调用工具 execute 函数                                                   │
│     • 支持取消信号（AbortSignal）                                             │
│     • 流式更新（onUpdate 回调）                                               │
│                              │                                               │
│                              ▼                                               │
│  5. 执行后钩子（After Tool Hook）                                             │
│     • 触发 after_tool_call 插件钩子                                           │
│     • 扫描工具结果中的 prompt injection                                       │
│     • 记录审计日志                                                            │
│                              │                                               │
│                              ▼                                               │
│  6. 返回结果给模型                                                            │
│     {                                                                        │
│       "content": [{ "type": "text", "text": "..." }],                         │
│       "details": { "totalLines": 42 }                                        │
│     }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 4: 工具执行流程*

#### 3.3.2 工具权限策略

OpenClaw 实现了多层次的工具权限控制：

```typescript
// src/agents/pi-tools.policy.ts
export interface ToolPolicy {
  // 全局策略
  global: {
    allow: string[];  // 允许的工具列表
    deny: string[];   // 拒绝的工具列表
  };
  
  // 按 Agent 策略
  perAgent: Map<string, {
    allow: string[];
    deny: string[];
  }>;
  
  // 按会话策略
  perSession: Map<string, {
    allow: string[];
    deny: string[];
  }>;
  
  // 沙箱策略
  sandbox: {
    mode: 'off' | 'non-main' | 'all';
    tools: {
      allow: string[];
      deny: string[];
    };
  };
  
  // 特权模式（elevated）
  elevated: {
    enabled: boolean;
    allowFrom: Map<string, string[]>;  // 按 provider 的允许列表
  };
}

// 策略解析函数
export function resolveToolPolicy(
  policy: ToolPolicy,
  agentId: string,
  sessionKey: string,
  isSandboxed: boolean
): string[] {
  // 1. 从全局策略开始
  let allowed = new Set(policy.global.allow);
  
  // 2. 应用 Agent 级策略
  const agentPolicy = policy.perAgent.get(agentId);
  if (agentPolicy) {
    agentPolicy.allow.forEach(t => allowed.add(t));
    agentPolicy.deny.forEach(t => allowed.delete(t));
  }
  
  // 3. 应用会话级策略
  const sessionPolicy = policy.perSession.get(sessionKey);
  if (sessionPolicy) {
    sessionPolicy.allow.forEach(t => allowed.add(t));
    sessionPolicy.deny.forEach(t => allowed.delete(t));
  }
  
  // 4. 应用沙箱策略
  if (isSandboxed) {
    policy.sandbox.tools.allow.forEach(t => allowed.add(t));
    policy.sandbox.tools.deny.forEach(t => allowed.delete(t));
  }
  
  return Array.from(allowed);
}
```

*代码示例 6: 工具权限策略系统*

### 3.4 记忆系统 (Memory System)

OpenClaw 的记忆系统采用**混合检索架构**，结合了向量搜索和全文搜索的优势：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        记忆系统架构                                          │
│                                                                              │
│  存储层 (Storage Layer)                                                      │
│  ├── MEMORY.md（长期记忆，人工维护）                                          │
│  ├── memory/YYYY-MM-DD.md（每日笔记，自动记录）                               │
│  └── ~/.openclaw/memory/{agentId}.sqlite（索引数据库）                        │
│                                                                              │
│  索引层 (Indexing Layer)                                                     │
│  ├── Chunking（分块）                                                         │
│  │   ├── 目标大小：~400 tokens/chunk                                          │
│  │   ├── 重叠：~80 tokens                                                     │
│  │   └── 边界保留：行边界、句子边界                                           │
│  │                                                                            │
│  ├── Embedding（向量化）                                                      │
│  │   ├── Provider: OpenAI / Gemini / Voyage / Ollama (local)                │
│  │   ├── 模型: text-embedding-3-large/small, text-embedding-004, etc.        │
│  │   └── 维度: 1536 (OpenAI), 768 (Gemini), etc.                             │
│  │                                                                            │
│  └── 数据库存储                                                               │
│      ├── files 表：文件元数据（mtime, size, hash）                            │
│      ├── chunks 表：文本块内容 + 行范围                                       │
│      ├── chunks_vec 虚表：向量数据（sqlite-vec）                              │
│      └── chunks_fts 虚表：全文索引（FTS5）                                    │
│                                                                              │
│  检索层 (Retrieval Layer)                                                    │
│  ├── Vector Search（向量搜索）                                                │
│  │   └── 余弦相似度：理解语义，处理同义词、近义词                              │
│  │                                                                            │
│  ├── BM25 Search（全文搜索）                                                  │
│  │   └── 精确匹配：处理特定术语、代码片段、ID                                 │
│  │                                                                            │
│  ├── Hybrid Fusion（混合融合）                                                │
│  │   └── Score_total = 0.7 × Score_vector + 0.3 × Score_bm25                 │
│  │                                                                            │
│  ├── MMR Rerank（最大边际相关性）                                             │
│  │   └── 去重：避免返回相似度过高的重复结果                                   │
│  │                                                                            │
│  └── Temporal Decay（时间衰减）                                               │
│      └── 新内容权重更高，旧内容逐渐降低                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 5: 记忆系统架构*

#### 3.4.1 混合搜索实现

```typescript
// src/memory/hybrid-search.ts
export async function hybridSearch(
  db: Database,
  query: string,
  config: MemoryConfig
): Promise<SearchResult[]> {
  // 1. 获取查询的向量嵌入
  const queryEmbedding = await embedQuery(query, config.embeddingProvider);
  
  // 2. 向量搜索
  const vectorResults = await db.all(`
    SELECT c.id, c.text, c.path, c.lineStart, c.lineEnd,
           vec_distance_cosine(v.embedding, ?) AS vectorScore
    FROM chunks_vec v
    JOIN chunks c ON c.id = v.id
    ORDER BY vectorScore ASC
    LIMIT ?
  `, [queryEmbedding, config.vectorTopK]);
  
  // 3. BM25 全文搜索
  const bm25Results = await db.all(`
    SELECT c.id, c.text, c.path, c.lineStart, c.lineEnd,
           bm25(chunks_fts) AS bm25Score
    FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.id
    WHERE chunks_fts MATCH ?
    ORDER BY bm25Score ASC
    LIMIT ?
  `, [query, config.bm25TopK]);
  
  // 4. 融合结果
  const fusedResults = fuseResults(vectorResults, bm25Results, {
    vectorWeight: config.hybridWeight.vector,  // 默认 0.7
    bm25Weight: config.hybridWeight.bm25,      // 默认 0.3
  });
  
  // 5. MMR 重排序（去重）
  const rerankedResults = mmrRerank(fusedResults, {
    lambda: config.mmrLambda,  // 默认 0.7
    threshold: config.mmrThreshold,  // 默认 0.85
  });
  
  // 6. 时间衰减
  const finalResults = applyTemporalDecay(rerankedResults, {
    halfLife: config.temporalHalfLife,  // 默认 30 天
  });
  
  return finalResults.slice(0, config.finalTopK);
}

// 融合函数
function fuseResults(
  vectorResults: RawResult[],
  bm25Results: RawResult[],
  weights: { vectorWeight: number; bm25Weight: number }
): FusedResult[] {
  const scores = new Map<string, FusedResult>();
  
  // 归一化向量分数（余弦距离 → 相似度）
  const maxVectorDist = Math.max(...vectorResults.map(r => r.vectorScore));
  vectorResults.forEach(r => {
    const normalizedScore = 1 - (r.vectorScore / maxVectorDist);
    scores.set(r.id, {
      ...r,
      score: weights.vectorWeight * normalizedScore,
    });
  });
  
  // 归一化 BM25 分数
  const maxBm25Score = Math.max(...bm25Results.map(r => r.bm25Score));
  bm25Results.forEach(r => {
    const normalizedScore = 1 - (r.bm25Score / maxBm25Score);
    const existing = scores.get(r.id);
    if (existing) {
      existing.score += weights.bm25Weight * normalizedScore;
    } else {
      scores.set(r.id, {
        ...r,
        score: weights.bm25Weight * normalizedScore,
      });
    }
  });
  
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score);
}
```

*代码示例 7: 混合搜索实现*

### 3.5 会话管理 (Session Management)

OpenClaw 的会话管理采用**双层持久化**架构：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        会话持久化架构                                        │
│                                                                              │
│  Layer 1: Session Store (sessions.json)                                      │
│  ├── 作用：会话元数据索引                                                     │
│  ├── 格式：JSON 键值对                                                        │
│  ├── 键：sessionKey（例如：main:telegram:+1234567890）                        │
│  └── 值：SessionEntry                                                         │
│      {                                                                        │
│        "sessionId": "uuid",                                                   │
│        "agentId": "main",                                                     │
│        "channel": "telegram",                                                 │
│        "userId": "+1234567890",                                               │
│        "lastActivity": "2026-03-22T10:30:00Z",                                │
│        "tokenCount": 15234,                                                   │
│        "toggles": { "reasoning": "medium" }                                   │
│      }                                                                        │
│                                                                              │
│  Layer 2: Transcript (<sessionId>.jsonl)                                     │
│  ├── 作用：完整对话历史（Append-only）                                        │
│  ├── 格式：JSON Lines，每行一条消息                                           │
│  └── 结构：树状结构（支持分支）                                               │
│                                                                              │
│  示例 JSONL：                                                                 │
│  {"id":"1","type":"session","parentId":null,"timestamp":"..."}              │
│  {"id":"2","type":"user","parentId":"1","content":"Hello"}                │
│  {"id":"3","type":"assistant","parentId":"2","content":"Hi!"}             │
│  {"id":"4","type":"tool_call","parentId":"3","tool":"read","args":{...}}   │
│  {"id":"5","type":"tool_result","parentId":"4","content":"..."}           │
│                                                                              │
│  分支支持：                                                                   │
│  {"id":"6","type":"user","parentId":"3","content":"Alternative path"}     │
│  {"id":"7","type":"assistant","parentId":"6","content":"Branch reply"}    │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 6: 会话持久化架构*

#### 3.5.1 树状会话结构

```typescript
// src/session/session-manager.ts
export class SessionManager {
  private sessionFile: string;
  private entries: Map<string, SessionEntry>;
  private tree: SessionTree;
  
  constructor(sessionFile: string) {
    this.sessionFile = sessionFile;
    this.entries = new Map();
    this.tree = { root: null, nodes: new Map() };
    this.loadFromDisk();
  }
  
  // 追加消息（append-only）
  appendMessage(message: Message): void {
    const entry: SessionEntry = {
      id: generateUUID(),
      type: message.role,
      parentId: this.getLeafEntry()?.id || null,
      timestamp: new Date().toISOString(),
      content: message.content,
      metadata: message.metadata,
    };
    
    // 追加到 JSONL 文件
    fs.appendFileSync(this.sessionFile, JSON.stringify(entry) + '\n');
    
    // 更新内存中的树
    this.entries.set(entry.id, entry);
    this.tree.nodes.set(entry.id, { ...entry, children: [] });
    
    // 更新父节点的 children
    if (entry.parentId) {
      const parent = this.tree.nodes.get(entry.parentId);
      if (parent) {
        parent.children.push(entry.id);
      }
    }
  }
  
  // 分支：从指定节点创建新分支
  branch(entryId: string): void {
    const targetEntry = this.entries.get(entryId);
    if (!targetEntry) {
      throw new Error(`Entry ${entryId} not found`);
    }
    
    // 创建新的叶子节点，继承指定节点的父节点
    const newEntry: SessionEntry = {
      id: generateUUID(),
      type: 'branch_point',
      parentId: targetEntry.parentId,
      timestamp: new Date().toISOString(),
      content: `[Branch from ${entryId}]`,
    };
    
    fs.appendFileSync(this.sessionFile, JSON.stringify(newEntry) + '\n');
    this.entries.set(newEntry.id, newEntry);
    
    // 后续消息将挂在这个新节点下
  }
  
  // 重建对话上下文
  buildSessionContext(): Message[] {
    const leaf = this.getLeafEntry();
    if (!leaf) return [];
    
    // 从叶子节点回溯到根节点
    const path: SessionEntry[] = [];
    let current: SessionEntry | undefined = leaf;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.entries.get(current.parentId) : undefined;
    }
    
    // 转换为模型消息格式
    return path.map(entry => ({
      role: entry.type,
      content: entry.content,
      ...(entry.toolCalls ? { tool_calls: entry.toolCalls } : {}),
      ...(entry.toolCallId ? { tool_call_id: entry.toolCallId } : {}),
    }));
  }
  
  // 获取完整树结构（用于 UI 展示）
  getTree(): SessionTree {
    return this.tree;
  }
}
```

*代码示例 8: 会话管理器实现*

### 3.6 上下文压缩 (Context Compaction)

当对话历史过长时，OpenClaw 会触发**上下文压缩**机制，避免超出模型的上下文窗口限制：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        上下文压缩流程                                        │
│                                                                              │
│  触发条件：                                                                   │
│  • 上下文 token 数 > contextWindowTokens - reserveTokens                     │
│                                                                              │
│  压缩策略（三级递进）：                                                       │
│                                                                              │
│  Level 1: Context Pruning（轻量级裁剪）                                       │
│  ├── Soft Trim：旧 tool result 保留 head + tail，中间替换为 "..."             │
│  │   └── 触发条件：总字符占比 > 30%                                          │
│  └── Hard Clear：旧 tool result 完全替换为占位符 "[Old tool result cleared]" │
│      └── 触发条件：总字符占比 > 50%                                          │
│                                                                              │
│  Level 2: Compaction（LLM 摘要）                                              │
│  ├── 1. 将历史消息分块（按 token 预算）                                       │
│  ├── 2. 每块调用 LLM 生成摘要                                                 │
│  ├── 3. 合并摘要，生成最终压缩版本                                            │
│  ├── 4. 保留关键信息：文件操作记录、工具失败信息、工作区规则                  │
│  └── 5. 修复 tool_use/tool_result 配对关系                                  │
│                                                                              │
│  Level 3: Truncation（暴力截断）                                              │
│  └── 保留最近 N 条消息，丢弃更早的历史                                        │
│                                                                              │
│  恢复机制：                                                                   │
│  • 如果压缩后仍然溢出，截断超大 tool result                                   │
│  • 通过 Session Branching 重写历史（持久级修改）                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 7: 上下文压缩流程*

---

## 4. 高级特性

### 4.1 Heartbeat 自主循环

OpenClaw 的 **Heartbeat** 机制使智能体能够**自主运行**，无需用户主动触发：

```typescript
// src/heartbeat/heartbeat-runner.ts
export class HeartbeatRunner {
  private intervalMs: number;
  private checklist: HeartbeatChecklist;
  private timer: NodeJS.Timeout | null = null;
  
  constructor(config: HeartbeatConfig) {
    this.intervalMs = config.intervalMs || 30 * 60 * 1000; // 默认 30 分钟
    this.checklist = loadChecklist(config.checklistPath);
  }
  
  start(): void {
    this.timer = setInterval(async () => {
      await this.runHeartbeatCycle();
    }, this.intervalMs);
  }
  
  private async runHeartbeatCycle(): Promise<void {
    // 1. 读取 HEARTBEAT.md 中的检查清单
    const tasks = this.checklist.getTasks();
    
    // 2. 构建心跳提示词
    const heartbeatPrompt = `
      This is an autonomous heartbeat cycle. 
      Please review the following checklist and execute any pending tasks:
      ${tasks.map(t => `- ${t.description}`).join('\n')}
      
      After execution, respond with HEARTBEAT_OK if everything is normal,
      or describe any issues that require attention.
    `;
    
    // 3. 触发 Agent Loop（无用户输入）
    const result = await runAgentLoop({
      sessionKey: 'heartbeat:main',
      prompt: heartbeatPrompt,
      isHeartbeat: true,
    });
    
    // 4. 处理结果
    if (result.text.includes('HEARTBEAT_OK')) {
      // 正常，静默处理
      logger.debug('Heartbeat cycle completed normally');
    } else {
      // 有异常，通知用户
      await notifyUser({
        channel: this.checklist.alertChannel,
        message: `Heartbeat Alert: ${result.text}`,
      });
    }
    
    // 5. 更新检查清单状态
    this.checklist.updateLastRun();
  }
  
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
```

*代码示例 9: Heartbeat 自主循环实现*

### 4.2 多智能体协调 (Multi-Agent Orchestration)

OpenClaw 支持**多智能体协调**，一个智能体可以创建子智能体（Subagent）来并行处理任务：

```typescript
// src/tools/sessions-spawn.ts
export const sessionsSpawnTool: AgentTool = {
  name: 'sessions_spawn',
  description: 'Spawn a subagent to execute a task in isolation',
  parameters: Type.Object({
    agentId: Type.String({ description: 'Target agent ID' }),
    task: Type.String({ description: 'Task description for the subagent' }),
    timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' })),
  }),
  execute: async (id, params, signal, onUpdate) => {
    // 1. 验证权限（父智能体是否有权创建子智能体）
    const parentSession = getCurrentSession();
    if (!canSpawnSubagent(parentSession.agentId, params.agentId)) {
      throw new Error(`Agent ${parentSession.agentId} cannot spawn ${params.agentId}`);
    }
    
    // 2. 创建子智能体会话
    const subagentSessionKey = `agent:${params.agentId}:subagent:${generateUUID()}`;
    const subagentSession = await createSession({
      sessionKey: subagentSessionKey,
      agentId: params.agentId,
      spawnedBy: parentSession.sessionKey,
      workspace: resolveAgentWorkspace(params.agentId), // 使用目标 agent 的工作区
    });
    
    // 3. 在子智能体中运行任务
    const subagentRun = runAgentLoop({
      sessionKey: subagentSessionKey,
      prompt: params.task,
      timeoutMs: params.timeout || 300000, // 默认 5 分钟
    });
    
    // 4. 流式转发子智能体的事件
    subagentRun.on('message_delta', (delta) => {
      onUpdate?.({ type: 'subagent_message', delta });
    });
    
    subagentRun.on('tool_execution_start', (tool) => {
      onUpdate?.({ type: 'subagent_tool_start', tool });
    });
    
    // 5. 等待子智能体完成
    const result = await subagentRun;
    
    // 6. 返回结果给父智能体
    return {
      content: [{ 
        type: 'text', 
        text: `Subagent completed. Result:\n${result.text}` 
      }],
      details: {
        subagentSessionKey,
        turns: result.turns,
        toolCalls: result.toolCalls,
      },
    };
  },
};
```

*代码示例 10: 子智能体创建工具*

### 4.3 网关架构 (Gateway Architecture)

OpenClaw 的网关是其**中央神经系统**，负责消息路由和平台适配：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        网关架构 (Gateway)                                    │
│                                                                              │
│  WebSocket Server (127.0.0.1:18789)                                          │
│  ├── 协议：WebSocket（持久连接）                                              │
│  ├── 认证：Challenge-Response + Token                                        │
│  └── 功能：                                                                  │
│      • 接收来自各平台的消息                                                   │
│      • 路由到正确的 Agent Session                                             │
│      • 流式转发 Agent 响应                                                    │
│      • 管理多平台连接                                                         │
│                                                                              │
│  Channel Layer（平台适配层）                                                  │
│  ├── WhatsApp Adapter                                                        │
│  │   └── 将 WhatsApp 消息格式转换为内部标准格式                               │
│  ├── Telegram Adapter                                                        │
│  ├── Slack Adapter                                                           │
│  ├── Discord Adapter                                                         │
│  └── ...（50+ 平台）                                                         │
│                                                                              │
│  内部标准消息格式：                                                           │
│  {                                                                           │
│    "messageId": "uuid",                                                      │
│    "platform": "telegram",                                                   │
│    "channelId": "-1001234567890",                                            │
│    "userId": "123456789",                                                    │
│    "text": "Hello",                                                          │
│    "timestamp": "2026-03-22T10:30:00Z",                                      │
│    "attachments": [...],                                                     │
│    "mentions": [...]                                                         │
│  }                                                                           │
│                                                                              │
│  Session Resolution（会话解析）                                               │
│  ├── sessionKey = "{agentId}:{platform}:{channelId}:{userId}"               │
│  └── 示例："main:telegram:-1001234567890:123456789"                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

*图 8: 网关架构*

---

## 5. 安全机制

### 5.1 多层防御体系

OpenClaw 实现了**多层防御体系**来应对安全威胁：

| 层级 | 机制 | 作用 |
|------|------|------|
| **L1: 提示词安全** | System Prompt Safety Rules | 引导模型行为，但可被绕过 |
| **L2: 工具策略** | Tool Allowlist/Denylist | 硬编码控制可用工具 |
| **L3: 沙箱隔离** | Docker Sandbox | 隔离工具执行环境 |
| **L4: 审批流程** | Human-in-the-Loop | 高危操作需人工确认 |
| **L5: 审计日志** | Audit Logging | 记录所有操作，便于追溯 |

*表 4: 安全防御层级*

### 5.2 Prompt Injection 防护

Prompt Injection 是智能体面临的最严重安全威胁之一：

```
攻击场景：
1. 攻击者在网页/邮件/文档中嵌入恶意指令
2. 智能体读取这些内容
3. 恶意指令劫持智能体行为
4. 智能体执行危险操作（删除文件、泄露数据等）

防护措施：
1. 内容过滤：扫描 tool result 中的可疑模式
2. 工具结果隔离：在 tool result 前添加警告前缀
3. 权限最小化：限制工具可用范围
4. 沙箱隔离：在隔离环境中执行工具
5. 人工审批：高危操作需人工确认
```

---

## 6. 总结与展望

### 6.1 OpenClaw 的核心创新

1. **ReAct 框架的工业级实现**: OpenClaw 将学术界的 ReAct 框架转化为生产级系统，通过双层循环、EventStream、工具权限策略等工程创新，实现了稳定、可扩展的智能体架构。

2. **本地优先与 Markdown 真相源**: 所有数据存储在本地，以 Markdown 为单一真相源，确保隐私、可控性和人类可读性。

3. **极简工具集**: 仅提供 4 个核心工具（read、write、edit、bash），智能体通过编写代码来解决具体问题，体现了"代码即工具"的哲学。

4. **混合记忆检索**: 结合向量搜索和 BM25 全文搜索，实现了语义理解和精确匹配的平衡。

5. **自主运行能力**: Heartbeat 机制使智能体能够自主运行，无需人工触发，实现了真正的"智能体"而非"聊天机器人"。

### 6.2 ReAct 框架的启示

ReAct 框架的成功实践表明：

1. **推理与行动的结合**是智能体的核心能力，单纯的语言生成或工具调用都不足以应对复杂任务。

2. **迭代循环**比一次性规划更适应动态环境，智能体需要根据观察结果不断调整策略。

3. **可解释性**是智能体的重要特性，ReAct 的 Thought-Action-Observation 链条提供了清晰的决策轨迹。

### 6.3 未来发展方向

1. **更强的自主性**: 从被动响应到主动规划，智能体将能够自主设定目标并执行长期任务。

2. **多智能体协作**: 从单智能体到多智能体系统，实现更复杂的协作和分工。

3. **更深度的工具集成**: 从通用工具到领域专用工具，智能体将能够操作更多类型的系统。

4. **更智能的记忆管理**: 从被动存储到主动整理，智能体将能够自动提炼、归纳、遗忘记忆。

---

## 参考资源

### 官方文档

- OpenClaw 官方文档: https://docs.openclaw.ai
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- ClawHub 技能仓库: https://clawhub.com

### 学术论文

- Yao, S., et al. (2022). ReAct: Synergizing Reasoning and Acting in Language Models. ICLR 2023.
- Yao, S., et al. (2023). Tree of Thoughts: Deliberate Problem Solving with Large Language Models. NeurIPS 2024.

### 社区资源

- OpenClaw Discord 社区
- OpenClaw Subreddit
- OpenClaw 中文社区 (ClawCN)

---

*本报告基于 OpenClaw 2026.3 版本的公开文档、源码和社区讨论整理而成。由于 OpenClaw 快速迭代，部分细节可能随版本更新而变化。*
