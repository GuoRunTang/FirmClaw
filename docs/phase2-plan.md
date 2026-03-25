# FirmClaw Phase 2 开发计划

> **状态**: 进行中
> **基于**: v1.0.0 (Phase 1 完成)
> **目标版本**: v1.6.0
> **设计决策**: Q1→C, Q2→B, Q3→A, Q4→B

---

## 设计决策总结

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 工作目录 baseDir | **C: agent config 传入** | AgentConfig 新增 `workDir` 字段，所有文件/bash 工具共享 |
| 权限策略 | **B: 完整实现** | 路径白名单 + bash 命令黑名单 + 危险操作拦截，Phase 5 可扩展为人工审批 |
| bash 工具 | **A: 升级为 spawn()** | 支持流式输出、cwd、超时可配、信号控制 |
| 参数校验 | **B: 引入 ajv** | 注册工具时编译 schema，execute 前自动校验 |

---

## 整体架构变更

### 新增文件

```
src/
├── tools/
│   ├── read.ts          ← [v1.2] 文件读取工具
│   ├── write.ts         ← [v1.3] 文件写入工具
│   ├── edit.ts          ← [v1.4] 文件编辑工具
│   ├── permissions.ts   ← [v1.6] 权限策略模块
│   └── context.ts       ← [v1.1] ToolContext 接口定义
├── tests/
│   ├── test-read.ts     ← [v1.2]
│   ├── test-write.ts    ← [v1.3]
│   ├── test-edit.ts     ← [v1.4]
│   ├── test-bash-v2.ts  ← [v1.5]
│   └── test-permissions.ts ← [v1.6]
```

### 修改文件

```
src/
├── tools/
│   ├── types.ts         ← [v1.1] Tool 接口增强（支持 context）
│   ├── registry.ts      ← [v1.1] ajv 校验集成 + context 传递
│   └── bash.ts          ← [v1.5] 重写为 spawn()
├── agent/
│   ├── agent-loop.ts    ← [v1.1] 传递 workDir 给 ToolRegistry
│   └── types.ts         ← [v1.1] AgentConfig 新增 workDir
└── index.ts             ← [每版] 逐步注册新工具
```

### 依赖变更

```json
{
  "ajv": "^8.17.0"    // JSON Schema 校验
}
```

---

## v1.1.0: 基础设施 — ToolContext + ajv 校验

**目标**: 建立所有后续工具共享的基础设施

### 1.1.1 创建 `src/tools/context.ts`

```typescript
/**
 * 工具执行上下文 —— 每次工具调用时由 AgentLoop 注入
 */
export interface ToolContext {
  /** 工作目录（文件工具的根路径） */
  workDir: string;
  /** 当前会话 ID（预留，Phase 3 用） */
  sessionId?: string;
}
```

### 1.1.2 修改 `src/tools/types.ts`

```typescript
// ToolExecuteFn 签名变更：新增 context 参数
export type ToolExecuteFn = (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
```

### 1.1.3 修改 `src/tools/registry.ts`

- 安装 ajv: `npm install ajv`
- 注册工具时自动编译 JSON Schema（ajv instance）
- 新增 `execute(name, params, context)` 方法：先校验再调用
- 校验失败时返回 `ToolResult { content: '参数校验失败: ...', isError: true }`

### 1.1.4 修改 `src/agent/types.ts`

```typescript
export interface AgentConfig {
  systemPrompt: string;
  maxTurns: number;
  workDir?: string;  // 新增：工作目录，默认 process.cwd()
}
```

### 1.1.5 修改 `src/agent/agent-loop.ts`

- 从 `config.workDir` 构建 ToolContext
- 调用 `registry.execute(toolName, args, context)` 替代 `tool.execute(args)`

### 1.1.6 修改 `src/tools/bash.ts`

- execute 签名适配新接口 `(params, context)` 
- 使用 `context.workDir` 作为 cwd（先用 exec 的 cwd 选项，v1.5 再升级 spawn）

### 1.1.7 修改 `src/index.ts`

- AgentConfig 传入 workDir
- 注册 bash 工具适配

### 1.1.8 运行 test:bash + test:agent 确认不回退

### 验证

```bash
npm run test:bash   # 必须通过
npm run test:agent  # 必须通过
```

### Git

```bash
git add -A && git commit -m "v1.1.0: ToolContext + ajv parameter validation"
git tag v1.1.0
```

---

## v1.2.0: read 工具

**目标**: 智能体能读取文件内容，支持大文件分段

### 1.2.1 创建 `src/tools/read.ts`

功能：
- `path` 参数（必填）：文件相对/绝对路径
- `offset` 参数（可选）：起始行号，默认 1
- `limit` 参数（可选）：读取行数，默认全部
- 路径解析：如果 path 是相对路径，拼接 `context.workDir`
- 二进制文件检测：检查前 8KB 是否包含 null byte，是则拒绝读取
- 输出格式：带行号的文本 `     1:line content\n     2:line content\n`
- 错误处理：文件不存在、权限不足、路径越界

```typescript
export const readTool: Tool = {
  name: 'read_file',
  description: 'Read file contents with optional line range (offset/limit). Returns text with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (relative to workDir or absolute)' },
      offset: { type: 'number', description: 'Start line number (1-based), default 1' },
      limit: { type: 'number', description: 'Number of lines to read, default all' },
    },
    required: ['path'],
  },
  // ...
};
```

### 1.2.2 创建 `src/tests/test-read.ts`

测试用例：
1. 读取普通文本文件
2. offset/limit 分段读取
3. 读取不存在的文件（错误）
4. 读取二进制文件（拒绝）
5. 相对路径 + 绝对路径

### 1.2.3 修改 `src/index.ts` — 注册 readTool

### 验证

```bash
npx tsx src/tests/test-read.ts
npm run test:agent  # 回归测试
```

### Git

```bash
git add -A && git commit -m "v1.2.0: read_file tool with offset/limit and binary detection"
git tag v1.2.0
```

---

## v1.3.0: write 工具

**目标**: 智能体能创建和覆写文件

### 1.3.1 创建 `src/tools/write.ts`

功能：
- `path` 参数（必填）：文件路径
- `content` 参数（必填）：写入内容
- `createDirs` 参数（可选，默认 true）：自动创建父目录
- 路径解析：同 read
- 安全检查：不允许写入 `.env` 等敏感文件（权限系统 v1.6 细化）
- 输出：写入字节数

```typescript
export const writeTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates parent directories automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'Content to write' },
      createDirs: { type: 'boolean', description: 'Auto-create parent directories, default true' },
    },
    required: ['path', 'content'],
  },
  // ...
};
```

### 1.3.2 创建 `src/tests/test-write.ts`

测试用例：
1. 创建新文件
2. 覆写已有文件
3. 自动创建多层目录
4. 写入后 read 验证内容一致

### 1.3.3 修改 `src/index.ts` — 注册 writeTool

### 验证

```bash
npx tsx src/tests/test-write.ts
npm run test:agent
```

### Git

```bash
git add -A && git commit -m "v1.3.0: write_file tool with auto-create directories"
git tag v1.3.0
```

---

## v1.4.0: edit 工具

**目标**: 智能体能精确编辑文件（查找替换）

### 1.4.1 创建 `src/tools/edit.ts`

功能：
- `path` 参数（必填）：文件路径
- `old_str` 参数（必填）：要被替换的文本
- `new_str` 参数（必填）：替换后的文本
- **唯一性校验**：old_str 必须在文件中只出现一次，多次出现则拒绝并报错
- 保留原文件换行风格（不自动转换 \r\n vs \n）
- 输出：替换了多少字符

```typescript
export const editTool: Tool = {
  name: 'edit_file',
  description: 'Find and replace text in a file. old_str must be unique in the file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      old_str: { type: 'string', description: 'Text to find (must be unique in file)' },
      new_str: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  // ...
};
```

### 1.4.2 创建 `src/tests/test-edit.ts`

测试用例：
1. 正常替换
2. old_str 在文件中出现多次 → 报错
3. old_str 不存在 → 报错
4. 替换后 read 验证

### 1.4.3 修改 `src/index.ts` — 注册 editTool

### 验证

```bash
npx tsx src/tests/test-edit.ts
npm run test:agent
```

### Git

```bash
git add -A && git commit -m "v1.4.0: edit_file tool with uniqueness validation"
git tag v1.4.0
```

---

## v1.5.0: bash 工具升级为 spawn()

**目标**: bash 工具支持流式输出、工作目录、可配超时

### 1.5.1 重写 `src/tools/bash.ts`

从 `exec()` 升级为 `spawn()`：
- `command` 参数（必填）：要执行的命令
- `timeout` 参数（可选，默认 30s）：超时秒数
- `cwd` 参数（可选）：工作目录，默认使用 `context.workDir`
- 使用 `child_process.spawn` + shell: true
- 流式收集 stdout/stderr
- 超时时发送 SIGTERM，5s 后 SIGKILL
- 输出截断：超过 100KB 时截断并标注

```typescript
export const bashTool: Tool = {
  name: 'bash',
  description: 'Execute a shell command. Supports timeout and working directory.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in seconds, default 30' },
      cwd: { type: 'string', description: 'Working directory, defaults to workDir' },
    },
    required: ['command'],
  },
  // ...
};
```

### 1.5.2 创建 `src/tests/test-bash-v2.ts`

测试用例：
1. 基本命令执行
2. 超时控制（timeout=1 执行 sleep 10）
3. cwd 指定工作目录
4. 大输出截断
5. 命令失败（非零退出码）

### 1.5.3 修改 `src/index.ts` — 更新系统提示词（提到新增工具）

### 验证

```bash
npx tsx src/tests/test-bash-v2.ts
npm run test:agent
```

### Git

```bash
git add -A && git commit -m "v1.5.0: bash tool upgraded to spawn() with streaming and cwd"
git tag v1.5.0
```

---

## v1.6.0: 权限策略系统

**目标**: 基础安全层，为 Phase 5 人工审批打基础

### 1.6.1 创建 `src/tools/permissions.ts`

设计为**中间件层**，不侵入工具实现：

```typescript
export interface PermissionPolicy {
  /** 校验文件操作权限 */
  checkFileAccess?(resolvedPath: string, operation: 'read' | 'write' | 'edit'): PermissionResult;
  /** 校验 bash 命令权限 */
  checkCommand?(command: string): PermissionResult;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;  // 拒绝原因
}
```

内置策略：
1. **路径白名单**（fileAccess）：
   - 默认允许 workDir 及其子目录
   - 可配置额外允许的路径列表
   - 拒绝访问系统敏感目录（Windows: C:\Windows, C:\Program Files 等）
2. **命令黑名单**（bash）：
   - `rm -rf /`, `del /f /s /q C:\`, `format`, `shutdown` 等
   - 可配置自定义黑名单
3. **危险文件保护**：
   - 禁止写入 `.env`、`credentials` 等文件（除非显式白名单）

### 1.6.2 修改 `src/tools/registry.ts`

- 新增 `setPolicy(policy: PermissionPolicy)` 方法
- `execute()` 中：校验通过后再调用工具
- 权限拒绝时返回 `ToolResult { content: 'Permission denied: ...', isError: true }`

### 1.6.3 修改 read.ts / write.ts / edit.ts / bash.ts

- 各工具的 execute 内部调用前先通过 context 获取 resolvedPath，交给 registry 校验

### 1.6.4 创建 `src/tests/test-permissions.ts`

测试用例：
1. 读取 workDir 内文件 → 允许
2. 读取 workDir 外文件 → 拒绝
3. 执行黑名单命令 → 拒绝
4. 执行正常命令 → 允许
5. 写入敏感文件 → 拒绝

### 1.6.5 修改 `src/index.ts`

- 创建 PermissionPolicy 实例
- 注册到 ToolRegistry

### 验证

```bash
npx tsx src/tests/test-permissions.ts
npm run test:agent
```

### Git

```bash
git add -A && git commit -m "v1.6.0: permission system with path whitelist and command blacklist"
git tag v1.6.0
```

---

## 断点续开指南

如果会话中断，按以下步骤恢复：

1. 读取本文件：`docs/phase2-plan.md`
2. 查看 git log 确认当前进度：`git log --oneline`
3. 查看 git tags：`git tag -l "v1.*"`
4. 找到最新完成的版本号，继续下一个版本的实现
5. 每个版本完成后必须：写代码 → 跑测试 → git commit + tag → 询问用户

### 当前进度

| 版本 | 内容 | 状态 |
|------|------|------|
| v1.1.0 | ToolContext + ajv 校验 | ⬜ 待开始 |
| v1.2.0 | read_file 工具 | ⬜ 待开始 |
| v1.3.0 | write_file 工具 | ⬜ 待开始 |
| v1.4.0 | edit_file 工具 | ⬜ 待开始 |
| v1.5.0 | bash spawn() 升级 | ⬜ 待开始 |
| v1.6.0 | 权限策略系统 | ⬜ 待开始 |
