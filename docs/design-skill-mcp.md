# FirmClaw Skill 与 MCP Client 集成设计方案

> 版本: v1.0 | 日期: 2026-04-02 | 状态: **已实现** (v7.0.0)

## 1. 目标

为 FirmClaw 增加两个核心能力：

1. **Skill 系统** — 兼容 Claude Code 的 `SKILL.md` 格式，支持技能发现、加载、激活和自动调用
2. **MCP Client** — 通过 Model Context Protocol 调用外部 MCP Server 提供的工具，支持 stdio 和 SSE 两种传输方式

## 2. 需求总结

| 维度 | 决策 |
|------|------|
| Skill 格式 | 兼容 Claude Code `SKILL.md`（YAML frontmatter + Markdown），同时兼容旧版 `.claude/commands/*.md` |
| MCP 范围 | 仅 Client（调用外部 MCP Server 工具） |
| Skill 与 MCP 关系 | Skill 可引用 MCP Server，激活时按需连接；MCP 工具也可独立于 Skill 使用 |
| 管理方式 | 配置文件 + CLI 命令（暂无 Web UI） |
| Skill 功能 | Prompt 模板 + 关联工具集 + 自动调用匹配 + 变量替换 |

---

## 3. 方案对比与选择

### 方案 A：轻量集成（✅ 推荐）

**核心思路**：Skill 作为 prompt 注入层，MCP 作为外部工具源。两者通过现有 `ToolRegistry` 统一桥接。

| 优点 | 缺点 |
|------|------|
| 改动最小，与现有架构高度一致 | 不支持 Skill 内嵌脚本执行（`\`command\`` 动态注入） |
| Skill 激活仅需修改 system prompt | MCP 工具无独立权限策略扩展点（复用全局策略） |
| MCP 工具直接注册到 ToolRegistry，AgentLoop 无感知 | — |
| 新增 6 个文件，修改 3 个现有文件 | — |

### 方案 B：深度集成

**核心思路**：新增 `SkillEngine` 和 `MCPBridge` 两套独立子系统，拥有各自的生命周期管理和权限策略。

| 优点 | 缺点 |
|------|------|
| 功能最完整 | 架构复杂度高，新增大量代码 |
| 支持 Skill hook 生命周期 | 与现有 `HookManager` 功能重叠 |
| MCP 可独立配置权限策略 | 需要修改 `AgentLoop` 核心循环 |
| 支持 Skill 内嵌脚本执行 | 安全风险较大 |

### 方案 C：插件式架构

**核心思路**：引入 `PluginHost` 抽象层，Skill 和 MCP 都是 Plugin 的子类型。

| 优点 | 缺点 |
|------|------|
| 扩展性最强 | 过度工程化（当前只有两种扩展类型） |
| 未来可轻松添加更多扩展类型 | 抽象层增加理解成本 |
| — | 与现有 `Tool` 接口兼容需要适配层 |

**结论**：采用 **方案 A（轻量集成）**，后续可通过增量迭代升级。

---

## 4. 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                         AgentLoop (ReAct)                            │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Context      │  │ ToolRegistry     │  │ SkillManager          │  │
│  │ Builder      │  │ (统一工具注册)    │  │ (技能发现 + 激活)     │  │
│  │              │  │                  │  │                       │  │
│  │ build() 注入  │  │  内置工具:        │  │  .claude/skills/      │  │
│  │ skill prompt │  │  - bash          │  │  .claude/commands/    │  │
│  └──────┬───────┘  │  - read_file     │  │  ~/.firmclaw/skills/  │  │
│         │          │  - write_file    │  └───────────┬───────────┘  │
│         │          │  - edit_file     │              │               │
│         │          │  - web_search    │              ▼               │
│         │          │  - web_fetch     │  ┌───────────────────────┐  │
│         │          │  - subagent      │  │ MCPClientManager      │  │
│         │          │                  │  │ (MCP Server 连接管理) │  │
│         │          │  MCP 工具:        │  │                       │  │
│         │          │  - mcp__*        │  │  ┌─────────────────┐  │  │
│         │          │  (动态注册)       │  │  │ stdio transport  │  │  │
│         │          │                  │  │  ├─────────────────┤  │  │
│         │          │                  │  │  │ SSE transport    │  │  │
│         │          │                  │  │  └─────────────────┘  │  │
│         │          │                  │  │                       │  │
│         │          │                  │  │  mcp-servers.yaml     │  │
│         │          │                  │  │  (配置文件)            │  │
│         │          │                  │  └───────────────────────┘  │
│         │          └──────────────────┘                            │
└─────────┼──────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          用户交互层                                   │
│  CLI: /skill, /skill-list, /mcp-list, /mcp-connect, /mcp-disconnect │
└──────────────────────────────────────────────────────────────────────┘
```

**核心设计原则**：

- **Skill 是 prompt 注入，不是工具** — Skill 本质是增强 LLM 在特定领域的行为模式，通过 `ContextBuilder` 注入到 system prompt
- **MCP 工具是普通工具** — 通过适配器转换为 `Tool` 接口注册到 `ToolRegistry`，AgentLoop 完全无感知
- **最小侵入性** — 不修改 `AgentLoop` 的 ReAct 核心循环逻辑

---

## 5. Skill 系统详细设计

### 5.1 目录结构规范

```
项目级（仅当前项目可用）:
  .claude/skills/<skill-name>/SKILL.md          # Claude Code 格式
  .claude/skills/<skill-name>/reference.md      # 可选：附属参考文件
  .claude/skills/<skill-name>/examples/         # 可选：示例目录
  .claude/commands/<command-name>.md            # Claude Code 旧格式（兼容）

用户级（所有项目可用）:
  ~/.firmclaw/skills/<skill-name>/SKILL.md
  ~/.firmclaw/commands/<command-name>.md
```

**加载优先级**：项目级 > 用户级（同名时项目级覆盖用户级）

### 5.2 SKILL.md 格式规范

SKILL.md 由两部分组成：YAML frontmatter（元数据）和 Markdown 正文（指令内容）。

```yaml
---
# === 必填字段 ===
name: code-review                          # 技能名称（小写字母、数字、连字符，最长 64 字符）

# === 推荐字段 ===
description: >                             # 技能描述（用于 LLM 自动匹配 + 用户菜单展示）
  对代码进行审查，检查代码风格、潜在错误和逻辑一致性。

# === 可选字段 ===
argument-hint: "[file-path]"               # 自动完成时的参数提示文本
disable-model-invocation: false            # 是否禁用 LLM 自动调用（默认 false）
user-invocable: true                       # 是否在 /skill 菜单中显示（默认 true）
allowed-tools:                             # 激活时可用的工具白名单（为空则不限制）
  - read_file
  - edit_file
  - bash
mcp-servers:                               # 引用的 MCP Server（激活时按需连接）
  - github
  - web-search
---

请对 $ARGUMENTS 指定的文件进行代码审查。

## 审查要点
1. **代码风格一致性** — 是否符合项目编码规范
2. **潜在逻辑错误** — 边界条件、空值处理、类型安全
3. **性能问题** — 不必要的循环、内存泄漏风险
4. **安全隐患** — 注入攻击、权限问题

## 输出格式
请输出结构化的审查报告，按严重程度分级：
- 🔴 严重（必须修复）
- 🟡 警告（建议修复）
- 🟢 建议（可选优化）
```

### 5.3 旧版 Commands 格式兼容

```markdown
<!-- .claude/commands/review.md -->
请对当前打开的代码文件进行审查。
重点关注代码风格、潜在错误和逻辑一致性。

用户提供的额外说明是：$ARGUMENTS
```

旧版 commands 文件：
- 无 frontmatter，纯 Markdown
- `name` 从文件名派生（`review.md` → `review`）
- 默认 `user-invocable: true`，`disable-model-invocation: true`（仅手动触发）

### 5.4 变量替换规则

| 变量 | 说明 | 示例 |
|------|------|------|
| `$ARGUMENTS` | 所有传入参数 | `/skill review src/index.ts` → `src/index.ts` |
| `$ARGUMENTS[N]` | 按索引访问参数（0-based） | `/skill deploy prod true` → `$ARGUMENTS[0]` = `prod` |
| `$0`, `$1`, ... | 索引参数的简写 | 同 `$ARGUMENTS[0]` |

> **注意**：暂不支持 `!`command`` 动态 shell 注入（安全风险）。支持 `context: fork` 通过 SubagentManager 实现。

### 5.5 核心类型定义

```typescript
// src/skills/types.ts

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
  /** Markdown 指令内容（经过变量替换后） */
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
  searchDirs: string[];  // 默认 ['skills', 'commands']
}

/** 技能激活结果 */
export interface SkillActivationResult {
  /** 激活是否成功 */
  success: boolean;
  /** 激活后的 prompt 内容 */
  prompt?: string;
  /** 需要连接的 MCP Server 列表 */
  requiredMCPServers?: string[];
  /** 错误信息 */
  error?: string;
}
```

### 5.6 SkillManager 实现

```typescript
// src/skills/skill-manager.ts

/**
 * src/skills/skill-manager.ts
 *
 * 技能管理器 — 负责 Skill 的发现、加载、匹配和激活。
 *
 * v7.0: 初始实现
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Skill, SkillMeta, SkillDirectory, SkillSource, SkillActivationResult } from './types.js';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();

  /**
   * 从多个目录加载技能
   *
   * 加载规则：
   * 1. 扫描 <dir>/skills/<name>/SKILL.md（Claude Code 新格式）
   * 2. 扫描 <dir>/commands/<name>.md（Claude Code 旧格式）
   * 3. 项目级同名技能覆盖用户级
   */
  async loadFromDirs(directories: SkillDirectory[]): Promise<number>;

  /**
   * 获取所有用户可调用的技能
   * 用于 /skill-list 命令展示
   */
  listUserInvocable(): Skill[];

  /**
   * 获取所有可自动调用的技能
   * 用于 AgentLoop 在每轮对话开始时判断
   */
  listAutoInvocable(): Skill[];

  /**
   * 根据用户输入匹配最佳技能
   *
   * 匹配策略：
   * 1. 关键词匹配：description 中包含用户输入的关键词
   * 2. 精确匹配：用户输入包含技能名称
   *
   * @returns 匹配到的技能，未匹配则返回 null
   */
  matchSkill(userMessage: string): Skill | null;

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
  activateSkill(skillName: string, args?: string): SkillActivationResult;

  /** 获取指定名称的技能 */
  get(name: string): Skill | undefined;

  /** 获取所有已加载技能 */
  getAll(): Skill[];

  /** 检查指定技能是否存在 */
  has(name: string): boolean;

  /** 获取已加载技能数量 */
  size(): number;
}
```

### 5.7 SKILL.md 解析器

```typescript
// src/skills/skill-parser.ts

/**
 * src/skills/skill-parser.ts
 *
 * SKILL.md 文件解析器 — 解析 frontmatter 和 Markdown 内容。
 *
 * v7.0: 初始实现
 */

import type { SkillMeta } from './types.js';

export class SkillParser {
  /**
   * 解析 SKILL.md 文件内容
   *
   * @param content - 文件原始内容
   * @returns { meta, body } 元数据和正文内容
   * @throws 当 frontmatter 格式无效时抛出
   */
  parse(content: string): { meta: SkillMeta; body: string };

  /**
   * 解析旧版 commands 文件（无 frontmatter）
   *
   * @param content - 文件内容
   * @param name - 从文件名派生的技能名称
   * @returns 元数据（全部使用默认值）和正文内容
   */
  parseCommand(content: string, name: string): { meta: SkillMeta; body: string };

  /**
   * 替换模板变量
   *
   * 支持变量：
   * - $ARGUMENTS — 全部参数
   * - $ARGUMENTS[N] / $N — 索引参数
   */
  replaceVariables(body: string, args?: string): string;
}
```

---

## 6. MCP Client 系统详细设计

### 6.1 配置文件格式

```yaml
# .firmclaw/mcp-servers.yaml
# MCP Server 连接配置

servers:
  # stdio 传输方式（本地进程）
  github:
    transport: stdio
    command: npx
    args: ["-y", "@anthropic/github-mcp-server"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}     # 支持环境变量引用
    autoStart: true                      # 系统启动时自动连接

  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@anthropic/filesystem-mcp-server", "/path/to/dir"]
    autoStart: false                     # 手动连接

  # SSE 传输方式（远程服务）
  web-search:
    transport: sse
    url: http://localhost:8081/mcp
    headers:                            # 可选：自定义请求头
      Authorization: Bearer ${MCP_TOKEN}
    autoStart: false
```

### 6.2 核心类型定义

```typescript
// src/mcp/types.ts

/**
 * src/mcp/types.ts
 *
 * MCP Client 系统的类型定义。
 *
 * v7.0: 初始实现
 */

/** MCP Server 配置 */
export interface MCPServerConfig {
  /** Server 唯一名称（用于标识和工具命名前缀） */
  name: string;
  /** 传输方式 */
  transport: 'stdio' | 'sse';
  /** stdio: 启动命令 */
  command?: string;
  /** stdio: 命令参数 */
  args?: string[];
  /** 环境变量（支持 ${ENV_VAR} 引用） */
  env?: Record<string, string>;
  /** sse: 服务器 URL */
  url?: string;
  /** sse: 自定义请求头 */
  headers?: Record<string, string>;
  /** 是否随系统自动启动（默认 false） */
  autoStart?: boolean;
}

/** MCP 配置文件格式 */
export interface MCPConfig {
  servers: Record<string, Omit<MCPServerConfig, 'name'>>;
}

/** MCP 工具信息（从 MCP Server 通过 tools/list 发现） */
export interface MCPToolInfo {
  /** 所属 Server 名称 */
  serverName: string;
  /** 工具名称 */
  toolName: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: Record<string, unknown>;
}

/** MCP Server 连接状态 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  transport: string;
  uptime?: number;           // 连接持续时间（毫秒）
  error?: string;            // 连接失败时的错误信息
}

/** MCP 工具适配器注册结果 */
export interface MCPToolRegistration {
  /** 注册的工具数量 */
  count: number;
  /** 注册的工具名称列表 */
  toolNames: string[];
}
```

### 6.3 MCPClientManager 实现

```typescript
// src/mcp/mcp-client-manager.ts

/**
 * src/mcp/mcp-client-manager.ts
 *
 * MCP 连接管理器 — 管理多个 MCP Server 的连接生命周期。
 *
 * v7.0: 初始实现
 *
 * 职责：
 * - 加载配置文件
 * - 启动/停止 MCP Server 连接（stdio / SSE）
 * - 发现 MCP Server 提供的工具
 * - 将 MCP 工具同步到 ToolRegistry
 * - 路由工具调用到正确的 MCP Server
 */

import type { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import type { MCPServerConfig, MCPConfig, MCPServerStatus, MCPToolRegistration } from './types.js';

export class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();

  /**
   * 从配置文件加载 MCP Server 配置
   *
   * 配置文件路径：.firmclaw/mcp-servers.yaml
   * 支持 ${ENV_VAR} 环境变量引用
   */
  async loadConfig(configPath: string): Promise<void>;

  /**
   * 启动指定的 MCP Server 连接
   *
   * stdio: 启动子进程，通过 stdin/stdout 通信
   * sse: 建立 HTTP SSE 连接
   *
   * 连接成功后自动调用 tools/list 获取工具列表
   */
  async connect(serverName: string): Promise<MCPToolRegistration>;

  /**
   * 断开指定 MCP Server
   *
   * stdio: 终止子进程
   * sse: 关闭 HTTP 连接
   *
   * 同时从 ToolRegistry 中移除该 Server 的所有工具
   */
  async disconnect(serverName: string): Promise<void>;

  /**
   * 启动所有 autoStart: true 的 Server
   *
   * 在系统初始化时调用
   */
  async autoConnect(registry: ToolRegistry): Promise<void>;

  /**
   * 断开所有连接（系统关闭时调用）
   */
  async disconnectAll(): Promise<void>;

  /**
   * 将所有已连接 Server 的工具同步到 ToolRegistry
   *
   * 命名规则：mcp__<server>__<tool>
   * 工具描述前缀：[MCP:<server>]
   */
  async syncToolsToRegistry(registry: ToolRegistry): Promise<MCPToolRegistration>;

  /**
   * 列出所有 Server 的连接状态
   */
  getStatus(): MCPServerStatus[];

  /**
   * 调用指定 MCP Server 的工具
   *
   * 由 ToolAdapter 通过 ToolRegistry.execute() 间接调用
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError?: boolean }>;

  /**
   * 检查指定 Server 是否已连接
   */
  isConnected(serverName: string): boolean;

  /**
   * 获取所有已连接 Server 的工具列表
   */
  listAllTools(): MCPToolInfo[];
}
```

### 6.4 MCP Tool 适配器

```typescript
// src/mcp/tool-adapter.ts

/**
 * src/mcp/tool-adapter.ts
 *
 * MCP Tool → FirmClaw Tool 适配器。
 *
 * 将 MCP Server 提供的工具转换为 FirmClaw 的 Tool 接口，
 * 使其可以无缝注册到 ToolRegistry，被 AgentLoop 调用。
 *
 * v7.0: 初始实现
 */

import type { Tool, ToolDefinition, ToolParameter } from '../tools/types.js';
import type { MCPToolInfo } from './types.js';
import type { MCPClientManager } from './mcp-client-manager.js';

/**
 * 将 MCP ToolInfo 转换为 FirmClaw Tool
 *
 * 转换规则：
 * - name: "mcp__<serverName>__<toolName>"
 * - description: "[MCP:<serverName>] <原始描述>"
 * - parameters: MCP inputSchema → FirmClaw ToolDefinition
 * - execute: 委托给 MCPClientManager.callTool()
 */
export function mcpToolToTool(
  info: MCPToolInfo,
  manager: MCPClientManager,
): Tool {
  return {
    name: `mcp__${info.serverName}__${info.toolName}`,
    description: `[MCP:${info.serverName}] ${info.description}`,
    parameters: adaptInputSchema(info.inputSchema),
    execute: async (params, _context) => {
      const result = await manager.callTool(
        info.serverName,
        info.toolName,
        params,
      );
      return {
        content: result.content,
        isError: result.isError,
      };
    },
  };
}

/**
 * 将 MCP JSON Schema 转换为 FirmClaw ToolDefinition
 *
 * MCP 的 inputSchema 遵循 JSON Schema 格式，
 * FirmClaw 的 ToolDefinition 是其子集，基本兼容。
 */
function adaptInputSchema(
  schema: Record<string, unknown>,
): ToolDefinition {
  // MCP inputSchema: { type: "object", properties: {...}, required: [...]}
  // FirmClaw ToolDefinition: { type: "object", properties: {...}, required?: [...]}
  return schema as unknown as ToolDefinition;
}
```

---

## 7. 与现有系统的集成点

### 7.1 ContextBuilder 修改

`src/session/context-builder.ts` 的 `build()` 方法需要支持 Skill prompt 注入：

```typescript
// 修改点：ContextBuilder
export class ContextBuilder {
  // 新增：Skill 管理器引用
  private skillManager?: SkillManager;

  /** 设置技能管理器 */
  setSkillManager(manager: SkillManager): void {
    this.skillManager = manager;
  }

  /**
   * 修改 build() 方法签名，新增 activeSkill 参数
   */
  async build(
    tools: ToolRegistry,
    sessionMeta?: SessionMeta,
    userMessage?: string,
    activeSkill?: string,  // [新增] 当前激活的技能名称
    skillArgs?: string,    // [新增] 技能参数
  ): Promise<string> {
    // ... 原有逻辑 ...

    // [新增] 如果有激活的技能，注入 skill prompt
    if (this.skillManager && activeSkill) {
      const result = this.skillManager.activateSkill(activeSkill, skillArgs);
      if (result.success && result.prompt) {
        // 将 skill prompt 追加到 system prompt 末尾
        systemPrompt += `\n\n## 当前激活的技能: ${activeSkill}\n${result.prompt}`;
      }
    }

    return systemPrompt;
  }
}
```

### 7.2 AgentLoop 修改

`src/agent/agent-loop.ts` 的 `run()` 方法需要支持 Skill 自动匹配：

```typescript
// 修改点：AgentLoop
export class AgentLoop {
  private skillManager?: SkillManager;  // [新增]

  setSkillManager(manager: SkillManager): void {
    this.skillManager = manager;
  }

  async run(userMessage: string): Promise<AgentResult> {
    // ... 原有逻辑 ...

    // [新增] Skill 自动匹配（在构建 system prompt 之前）
    let activeSkill: string | undefined;
    let skillArgs: string | undefined;

    if (this.skillManager) {
      const matched = this.skillManager.matchSkill(userMessage);
      if (matched) {
        activeSkill = matched.meta.name;
        skillArgs = userMessage;  // 将用户输入作为参数
        this.events.emit('skill_activated', {
          name: matched.meta.name,
          source: matched.source,
        });
      }
    }

    // 构建系统提示词（传入 activeSkill）
    let systemPrompt: string;
    if (this.contextBuilder && this.sessionManager) {
      systemPrompt = await this.contextBuilder.build(
        this.tools,
        sessionMeta,
        userMessage,
        activeSkill,  // [新增]
        skillArgs,    // [新增]
      );
    }

    // ... 后续逻辑不变 ...
  }
}
```

### 7.3 index.ts 初始化

`src/index.ts` 新增 Skill 和 MCP 初始化：

```typescript
// 修改点：index.ts

import { SkillManager } from './skills/skill-manager.js';
import { MCPClientManager } from './mcp/mcp-client-manager.js';

async function main(): Promise<void> {
  // ... 原有初始化 ...

  // ═══════════════════════════════════════════════════
  // v7.0: 初始化 Skill 系统
  // ═══════════════════════════════════════════════════
  const skillManager = new SkillManager();
  await skillManager.loadFromDirs([
    { path: path.join(workDir, '.claude'), type: 'project' },
    { path: path.join(os.homedir(), '.firmclaw'), type: 'user' },
  ]);
  console.log(`Skills loaded: ${skillManager.size()}`);

  // ═══════════════════════════════════════════════════
  // v7.0: 初始化 MCP Client 系统
  // ═══════════════════════════════════════════════════
  const mcpManager = new MCPClientManager();
  const mcpConfigPath = path.join(workDir, '.firmclaw', 'mcp-servers.yaml');
  if (fs.existsSync(mcpConfigPath)) {
    await mcpManager.loadConfig(mcpConfigPath);
    await mcpManager.autoConnect(tools);  // 自动连接 + 注册工具到 ToolRegistry
    console.log(`MCP servers connected: ${mcpManager.getStatus().filter(s => s.connected).length}`);
  }

  // 注入到 ContextBuilder 和 AgentLoop
  contextBuilder.setSkillManager(skillManager);
  agent.setSkillManager(skillManager);

  // ... 后续不变 ...
}
```

### 7.4 斜杠命令扩展

在 `src/index.ts` 的 `handleCommand()` 中新增命令：

```typescript
// 新增斜杠命令

case '/skill-list': {
  const skills = skillManager.listUserInvocable();
  if (skills.length === 0) {
    console.log('No skills available.');
  } else {
    console.log(`\nAvailable Skills (${skills.length}):`);
    skills.forEach((s, i) => {
      const source = s.source === 'project' ? 'project' : 'user';
      console.log(`  [${i + 1}] ${s.meta.name} (${source}) — ${s.meta.description}`);
      if (s.meta.argumentHint) {
        console.log(`      Usage: /skill ${s.meta.name} ${s.meta.argumentHint}`);
      }
    });
  }
  break;
}

case '/skill': {
  if (!arg) {
    console.log('Usage: /skill <name> [args]');
    break;
  }
  const parts = arg.split(/\s+/);
  const name = parts[0];
  const skillArgs = parts.slice(1).join(' ');
  const result = skillManager.activateSkill(name, skillArgs);
  if (result.success) {
    console.log(`Skill "${name}" activated.`);
    // 将激活的 skill 存储为当前会话状态
    // 后续的用户消息将自动携带 skill context
  } else {
    console.log(`Error: ${result.error}`);
  }
  break;
}

case '/mcp-list': {
  const statuses = mcpManager.getStatus();
  if (statuses.length === 0) {
    console.log('No MCP servers configured.');
  } else {
    console.log(`\nMCP Servers:`);
    statuses.forEach(s => {
      const status = s.connected ? `✓ (${s.toolCount} tools)` : `✗ ${s.error || ''}`;
      console.log(`  ${s.name}: ${status} [${s.transport}]`);
    });
  }
  break;
}

case '/mcp-connect': {
  if (!arg) {
    console.log('Usage: /mcp-connect <server-name>');
    break;
  }
  try {
    const result = await mcpManager.connect(arg);
    console.log(`Connected to "${arg}": ${result.count} tools registered.`);
    result.toolNames.forEach(n => console.log(`  - ${n}`));
  } catch (error) {
    console.log(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
  }
  break;
}

case '/mcp-disconnect': {
  if (!arg) {
    console.log('Usage: /mcp-disconnect <server-name>');
    break;
  }
  await mcpManager.disconnect(arg);
  console.log(`Disconnected from "${arg}".`);
  break;
}
```

---

## 8. 数据流详解

### 8.1 Skill 激活流程（手动）

```
用户输入: /skill code-review src/index.ts
  │
  ▼
handleCommand('/skill code-review src/index.ts')
  │
  ▼
SkillManager.activateSkill('code-review', 'src/index.ts')
  ├─ 1. 查找 Skill（先项目级，后用户级）
  ├─ 2. SkillParser.replaceVariables(prompt, 'src/index.ts')
  │      └─ $ARGUMENTS → "src/index.ts"
  ├─ 3. 加载附属文件（reference.md 等）
  └─ 4. 返回 SkillActivationResult { prompt, requiredMCPServers }
      │
      ▼ (如果 requiredMCPServers 不为空)
  MCPClientManager.connect('github')
  │
  ▼
存储 activeSkill 状态
  │
  ▼
下次用户消息 → ContextBuilder.build(..., activeSkill='code-review')
  └─ 注入 skill prompt 到 system prompt
```

### 8.2 Skill 自动匹配流程

```
用户输入: "帮我审查一下这段代码有没有问题"
  │
  ▼
AgentLoop.run(userMessage)
  │
  ▼
SkillManager.matchSkill(userMessage)
  ├─ 遍历 listAutoInvocable()
  ├─ 关键词匹配："审查" ↔ description 中的 "审查"
  └─ 返回 code-review Skill
      │
      ▼ (匹配成功)
  emit('skill_activated', { name: 'code-review' })
  │
  ▼
ContextBuilder.build(..., activeSkill='code-review')
  └─ 注入 skill prompt
      │
      ▼
AgentLoop 继续正常 ReAct 循环
```

### 8.3 MCP 工具调用流程

```
系统启动:
  MCPClientManager.loadConfig('.firmclaw/mcp-servers.yaml')
  └─ 解析 YAML → MCPServerConfig[]
      │
      ▼
  MCPClientManager.autoConnect(ToolRegistry)
  ├─ 对每个 autoStart: true 的 Server:
  │   ├─ connect('github')
  │   │   ├─ stdio: 启动子进程 npx @anthropic/github-mcp-server
  │   │   ├─ MCP initialize 握手
  │   │   └─ tools/list → [create_issue, search_repos, ...]
  │   │
  │   └─ syncToolsToRegistry()
  │       ├─ mcpToolToTool({ serverName: 'github', toolName: 'create_issue', ... })
  │       │   └─ { name: 'mcp__github__create_issue', description: '[MCP:github] ...', ... }
  │       └─ ToolRegistry.register(tool)
  │
  └─ 所有 MCP 工具已就绪

AgentLoop 调用工具:
  LLM 返回: tool_calls: [{ function: { name: 'mcp__github__create_issue', arguments: '{...}' } }]
  │
  ▼
  ToolRegistry.execute('mcp__github__create_issue', args, context)
  ├─ 1. 参数校验 (AJV)
  ├─ 2. Before Hooks (HookManager)
  ├─ 3. 权限检查 (PermissionPolicy)
  ├─ 4. 执行: tool.execute(args, context)
  │   └─ MCPClientManager.callTool('github', 'create_issue', args)
  │       └─ MCP 协议: tools/call → MCP Server → 返回结果
  ├─ 5. After Hooks (HookManager)
  └─ 6. PromptGuard 扫描
      │
      ▼
  返回 ToolResult → 作为 observation 反馈给 LLM
```

### 8.4 Skill + MCP 联动流程

```
SKILL.md 声明:
  mcp-servers: [github, web-search]

用户执行: /skill github-review PR-123
  │
  ▼
SkillManager.activateSkill('github-review', 'PR-123')
  ├─ 解析 SKILL.md
  ├─ 发现 mcp-servers: ['github', 'web-search']
  └─ 返回 { prompt, requiredMCPServers: ['github', 'web-search'] }
      │
      ▼
对每个未连接的 requiredMCPServer:
  MCPClientManager.connect('github')
  MCPClientManager.connect('web-search')
  │
  ▼
注册 MCP 工具到 ToolRegistry
  │
  ▼
ContextBuilder 注入 skill prompt
  └─ system prompt 中包含:
     "## 当前激活的技能: github-review"
     + skill prompt
     + LLM 可见 MCP 工具（已通过 ToolRegistry.toOpenAITools() 暴露）
```

---

## 9. 文件结构

```
src/
├── skills/                              # [新增] Skill 系统
│   ├── types.ts                         #   Skill 类型定义
│   ├── skill-manager.ts                 #   技能管理器（发现、加载、匹配、激活）
│   └── skill-parser.ts                  #   SKILL.md 解析器（frontmatter + 变量替换）
│
├── mcp/                                 # [新增] MCP Client 系统
│   ├── types.ts                         #   MCP 类型定义
│   ├── mcp-client-manager.ts            #   MCP 连接管理器
│   └── tool-adapter.ts                  #   MCP Tool → FirmClaw Tool 适配器
│
├── tools/                               # [不变]
│   ├── types.ts
│   ├── registry.ts
│   ├── context.ts
│   ├── bash.ts
│   ├── read.ts
│   ├── write.ts
│   ├── edit.ts
│   ├── web-search.ts
│   ├── web-fetch.ts
│   ├── subagent.ts
│   ├── permissions.ts
│   └── hook-manager.ts
│
├── session/
│   └── context-builder.ts               # [修改] 新增 setSkillManager() + build() 参数
│
├── agent/
│   ├── agent-loop.ts                    # [修改] 新增 Skill 自动匹配逻辑
│   └── types.ts                         # [不变]
│
└── index.ts                             # [修改] 新增 Skill + MCP 初始化和斜杠命令
```

**新增文件：6 个** | **修改文件：3 个**

---

## 10. 关键设计决策说明

### Q1: 为什么 Skill 是 prompt 注入而不是工具？

Skill 的本质是「增强 LLM 在特定领域的行为模式」，不是「给 LLM 一个新的工具」。Claude Code 的 Skill 也是作为 system prompt 的一部分注入的。

将其作为 prompt 注入的优势：
- 与现有 `ContextBuilder` 架构完全一致（`SOUL.md`、`AGENTS.md`、`MEMORY.md` 都是通过 ContextBuilder 注入的）
- 不需要修改 `AgentLoop` 的工具调用逻辑
- Skill 中可以通过 `allowed-tools` 字段提示 LLM 优先使用哪些工具
- LLM 看到的是增强后的 system prompt，行为自然改变

### Q2: 为什么 MCP 工具注册到 ToolRegistry 而不是单独管理？

统一到 `ToolRegistry` 的好处：
- **复用权限检查**：`PermissionPolicy` 自动对 MCP 工具生效
- **复用 Hook 机制**：`HookManager` 的 before/after hooks 自动对 MCP 工具生效
- **复用 PromptGuard**：MCP 工具返回的内容自动经过注入扫描
- **AgentLoop 无感知**：MCP 工具和内置工具在 `AgentLoop` 看来没有区别
- **统一发现机制**：`ToolRegistry.toOpenAITools()` 自动包含 MCP 工具，LLM 可见

### Q3: MCP 工具命名为什么用三段式 `mcp__<server>__<tool>`？

- **避免冲突**：内置工具（bash、read_file）和 MCP 工具名称空间完全隔离
- **可追溯性**：LLM 和用户从名称就能看出工具来自哪个 MCP Server
- **调试友好**：日志中 `mcp__github__create_issue` 一目了然
- **唯一性**：即使不同 MCP Server 提供同名工具也不会冲突

### Q4: 为什么暂不支持 `!`command`` 动态注入？

Claude Code 支持在 SKILL.md 中使用 `!`command`` 语法在发送前执行 shell 命令，但这引入了安全风险：
- Skill 文件可以包含任意 shell 命令
- 恶意 Skill 可以窃取环境变量或文件

后续可以在 `PermissionPolicy` 中增加 Skill 脚本审批机制后再支持。

---

## 11. 实施计划

### Phase 1：Skill 系统（预计 3 个文件 + 2 处修改）

| 序号 | 任务 | 文件 | 类型 |
|------|------|------|------|
| 1 | Skill 类型定义 | `src/skills/types.ts` | 新增 |
| 2 | SKILL.md 解析器 | `src/skills/skill-parser.ts` | 新增 |
| 3 | 技能管理器 | `src/skills/skill-manager.ts` | 新增 |
| 4 | ContextBuilder 注入 Skill prompt | `src/session/context-builder.ts` | 修改 |
| 5 | 初始化 + 斜杠命令 | `src/index.ts` | 修改 |
| 6 | Skill 单元测试 | `src/tests/test-skill-manager.ts` | 新增 |

### Phase 2：MCP Client（预计 3 个文件 + 2 处修改）

| 序号 | 任务 | 文件 | 类型 |
|------|------|------|------|
| 1 | 添加 `@modelcontextprotocol/sdk` 依赖 | `package.json` | 修改 |
| 2 | MCP 类型定义 | `src/mcp/types.ts` | 新增 |
| 3 | MCP 连接管理器 | `src/mcp/mcp-client-manager.ts` | 新增 |
| 4 | MCP Tool 适配器 | `src/mcp/tool-adapter.ts` | 新增 |
| 5 | 初始化 + 斜杠命令 | `src/index.ts` | 修改 |
| 6 | MCP 单元测试 | `src/tests/test-mcp-client.ts` | 新增 |

### Phase 3：Skill + MCP 联动（1 处修改）

| 序号 | 任务 | 文件 | 类型 |
|------|------|------|------|
| 1 | SKILL.md 支持 `mcp-servers` 字段 | `src/skills/types.ts` | 已包含 |
| 2 | 激活时按需连接 MCP | `src/skills/skill-manager.ts` | 修改 |
| 3 | 端到端集成测试 | `src/tests/test-skill-mcp.ts` | 新增 |

---

## 12. Claude Code 兼容性矩阵

| Claude Code 特性 | FirmClaw 支持 | 备注 |
|-----------------|:----------:|------|
| `.claude/skills/*/SKILL.md` | ✅ | 完全支持 |
| `.claude/commands/*.md` | ✅ | 旧格式兼容 |
| `~/.claude/skills/` | ✅ | 映射到 `~/.firmclaw/skills/` |
| YAML frontmatter | ✅ | 完全支持 |
| `$ARGUMENTS` 变量 | ✅ | 完全支持 |
| `$ARGUMENTS[N]` 索引 | ✅ | 完全支持 |
| `$0`, `$1` 简写 | ✅ | 完全支持 |
| `description` 字段 | ✅ | 用于自动匹配 |
| `argument-hint` 字段 | ✅ | CLI 补全提示 |
| `disable-model-invocation` | ✅ | 控制自动调用 |
| `user-invocable` | ✅ | 控制菜单可见性 |
| `allowed-tools` | ✅ | 工具白名单 |
| `mcp-servers` 字段 | ✅ | FirmClaw 扩展字段 |
| `!`command`` 动态注入 | ❌ | 安全考虑，暂不支持 |
| `context: fork` 子代理 | ⚠️ | 可通过 SubagentManager 实现 |
| `agent` 字段 | ⚠️ | 可通过 SubagentManager 实现 |
| `paths` 文件模式限制 | ❌ | 暂不支持 |
| `shell` 配置 | ❌ | 固定使用当前系统 shell |
| 嵌套目录自动发现 | ✅ | 递归扫描子目录 |
| 实时变更检测 | ❌ | 需重启加载 |

---

## 13. 安全考虑

### Skill 安全
- Skill 文件存储在本地文件系统，用户完全可控
- `allowed-tools` 限制 LLM 在 Skill 激活时可用的工具
- 不支持 `!`command`` 动态 shell 注入
- Skill prompt 注入到 system prompt，经过 `PromptGuard` 扫描

### MCP 安全
- MCP Server 配置存储在 `.firmclaw/mcp-servers.yaml`，不随 git 提交（建议加入 `.gitignore`）
- MCP 工具通过 `ToolRegistry` 统一管理，复用权限检查
- `PermissionPolicy` 对 MCP 工具默认不限制（用户可通过 `checkCommand` 自定义策略）
- MCP Server 通过 stdio 启动的子进程，资源受限
- MCP Server 连接失败不影响主系统运行（降级处理）

---

## 14. 依赖变更

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

仅新增 1 个依赖：`@modelcontextprotocol/sdk`（MCP 官方 TypeScript SDK）。
