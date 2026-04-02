# FirmClaw / AutoResearchClaw / Claude Code 架构对比与 Skill+MCP 设计分析

> 本文档基于对三个项目的深度代码分析，对比其架构差异，并为 FirmClaw 的 Skill + MCP 功能设计提供参考。

---

## 目录

1. [项目定位对比](#1-项目定位对比)
2. [架构范式对比](#2-架构范式对比)
3. [工具系统对比](#3-工具系统对比)
4. [Skill 系统对比](#4-skill-系统对比)
5. [MCP 支持对比](#5-mcp-支持对比)
6. [AutoResearchClaw 功能矩阵分析](#6-autoresearchclaw-功能矩阵分析)
7. [FirmClaw 与 Claude Code Skill 系统的差异](#7-firmclaw-与-claude-code-skill-系统的差异)
8. [三种实现方案对比](#8-三种实现方案对比)
9. [Skill + MCP 扩展性设计建议](#9-skill--mcp-扩展性设计建议)
10. [结论与建议](#10-结论与建议)

---

## 1. 项目定位对比

| 维度 | FirmClaw | AutoResearchClaw | Claude Code |
|------|----------|-----------------|-------------|
| **语言** | TypeScript (Node.js) | Python 3.11+ | TypeScript (Node.js) |
| **定位** | 通用 AI 编程智能体 | 全自主学术论文生成管道 | AI 编程助手（Claude Desktop CLI） |
| **核心模式** | ReAct 循环（工具调用） | 23 阶段状态机管道 | ReAct 循环（工具调用） |
| **交互方式** | 多轮对话 | CLI 一次性执行 | 多轮对话 |
| **工具定义** | 通用 `Tool` 接口 | 领域专用子系统 | 通用工具系统 + Skill 扩展 |
| **开源状态** | 私有项目 | 开源（MIT） | Anthropic 官方产品 |

**核心差异**：FirmClaw 和 Claude Code 是**通用编程智能体**（ReAct 循环 + 工具调用），AutoResearchClaw 是**领域专用管道**（固定阶段序列 + LLM 每阶段生成内容）。

---

## 2. 架构范式对比

### 2.1 FirmClaw — ReAct 智能体架构

```
用户输入
  │
  ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ AgentLoop     │───▶│ LLM API 调用    │───▶│ 工具调用     │
│ (ReAct 循环)  │◀───│ (多轮对话)       │◀───│ (ToolRegistry) │
└──────────────┘    └─────────────────┘    └──────────────┘
       │                     │                       │
       ▼                     ▼                       ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ ContextBuilder│   │ SessionManager  │   │ PermissionPolicy │
│ (系统提示词)   │   │ (会话持久化)     │   │ HookManager    │
└──────────────┘    └─────────────────┘    │ PromptGuard    │
                                            └──────────────┘
```

**关键特征**：
- **单循环驱动**：用户输入 → LLM 思考 → 调用工具 → 观察结果 → 再次思考 → 直到给出最终答案
- **工具即能力**：LLM 通过 `Tool` 接口调用 `read_file`、`write_file`、`bash` 等工具
- **动态决策**：LLM 自主决定何时调用哪个工具、调用几次

### 2.2 AutoResearchClaw — 管道状态机架构

```
用户输入（研究主题）
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│                    23 阶段管道状态机                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │ S1   │→│ S2   │→│ S3   │→│ ...  │→│ S22  │→│ S23  │    │
│  │ 主题 │ │ 分解 │ │ 搜索 │ │      │ │ 导出 │ │ 验证 │    │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │
│       │                                                      │
│       ▼                                                      │
│  PIVOT/REFINE 决策（Stage 15 可回滚到 Stage 8/13）            │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ PromptManager │    │ SkillRegistry │    │ EvolutionStore│
│ (每阶段提示词)  │    │ (技能注入)   │    │ (经验积累)   │
└──────────────┘    └──────────────┘    └──────────────┘
```

**关键特征**：
- **固定流程驱动**：23 个阶段按顺序执行，每个阶段有预定义的输入/输出契约
- **LLM 作为内容生成器**：每个阶段调用 LLM 生成特定内容（不是让 LLM 自主决策）
- **状态回溯**：Stage 15 的 PIVOT/REFINE 决策可以回滚到之前的阶段重新执行
- **技能作为 Prompt 注入**：不是让 LLM 选择技能，而是匹配引擎自动选择并注入到 prompt 中

### 2.3 Claude Code — ReAct 智能体 + Skill 扩展

```
用户输入
  │
  ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Claude Loop   │───▶│ Anthropic API   │───▶│ 工具调用     │
│ (ReAct 循环)  │◀───│ (多轮对话)       │◀───│ (内置工具)   │
└──────────────┘    └─────────────────┘    └──────────────┘
       │                                         │
       ▼                                         ▼
┌──────────────┐                         ┌──────────────┐
│ System Prompt│                         │ Skill 系统    │
│ + Skill 内容  │                         │ (.claude/skills)│
└──────────────┘                         └──────────────┘
```

**关键特征**：
- **通用智能体 + Skill 增强**：Claude Code 本身是通用编程智能体，Skill 提供领域知识注入
- **用户激活 Skill**：用户通过 `/skill-name` 或自动匹配激活特定 Skill
- **SKILL.md 格式**：YAML frontmatter + Markdown body 的标准格式

---

## 3. 工具系统对比

### 3.1 FirmClaw 工具系统

```typescript
// FirmClaw: 通用 Tool 接口
interface Tool {
  name: string;                          // "read_file"
  description: string;                   // 告诉 LLM 这个工具做什么
  parameters: ToolDefinition;            // JSON Schema 参数定义
  execute: (params, context) => Promise<ToolResult>;
}

// 执行链: 参数校验 → Before Hooks → 权限检查 → 执行 → After Hooks → Prompt Guard
class ToolRegistry {
  async execute(name, params, context): Promise<ToolResult>;
  toOpenAITools(): OpenAITool[];         // 转换为 OpenAI function calling 格式
}
```

**核心特点**：
- **统一接口**：所有工具实现同一个 `Tool` 接口
- **强安全层**：AJV 参数校验、权限策略、Hook 系统、Prompt Injection 防护
- **LLM 自主决策**：LLM 根据工具描述决定调用哪个工具
- **OpenAI 兼容**：`toOpenAITools()` 直接输出 function calling 格式

### 3.2 AutoResearchClaw 工具系统

AutoResearchClaw **没有通用的 Tool Interface/Tool Registry**。它使用**领域专用的子系统**作为"工具"：

| 子系统 | 职责 | 对应 FirmClaw 概念 |
|--------|------|-------------------|
| `literature/` | 文献搜索（OpenAlex/SemanticScholar/arXiv） | 可封装为 FirmClaw Tool |
| `experiment/` | 实验沙盒（本地/Docker/SSH/Colab/Agentic） | bash Tool 的一部分 |
| `experiment/code_agent.py` | 代码生成（LLM/Claude Code/Codex） | 内置能力，不是 Tool |
| `web/` | Web 搜索和 PDF 提取 | 可封装为 FirmClaw Tool |
| `mcp/tools.py` | MCP Server 暴露的工具 | MCP Client 适配 |
| `copilot/` | 辅助模式 | 无对应 |

```python
# AutoResearchClaw: 无通用工具接口，每个子系统是独立的
# 例如文献搜索直接在阶段实现中调用
class _STAGE_EXECUTORS:
    Stage.SEARCH_STRATEGY: _execute_search_strategy,
    Stage.LITERATURE_COLLECT: _execute_literature_collect,
    # ...

# 每个阶段执行器内部直接调用子系统
async def _execute_literature_collect(stage_dir, run_dir, config, adapters, llm, prompts):
    # 直接调用 literature/search.py 的函数
    papers = search_papers_multi_query(queries, ...)
```

### 3.3 关键差异总结

| 维度 | FirmClaw | AutoResearchClaw |
|------|----------|-----------------|
| **工具抽象** | 统一 `Tool` 接口 + `ToolRegistry` | 无统一抽象，领域子系统各自独立 |
| **LLM 角色** | LLM 选择并调用工具 | LLM 只生成内容，不调用工具 |
| **工具注册** | `registry.register(tool)` 手动注册 | 无注册机制，硬编码在阶段中 |
| **参数校验** | AJV JSON Schema 校验 | 无统一校验 |
| **安全层** | 权限策略 + Hook + PromptGuard | 沙盒隔离（进程/容器级别） |
| **OpenAI 兼容** | 原生支持 function calling | 不适用（不使用 function calling） |

**结论**：FirmClaw 的工具架构在**通用性和安全性**方面远超 AutoResearchClaw，这正是 ReAct 智能体模式的优势。AutoResearchClaw 的"工具"更接近于 FirmClaw 中的"服务层模块"，而不是可被 LLM 动态调用的 Tool。

---

## 4. Skill 系统对比

### 4.1 AutoResearchClaw Skill 系统（已实现）

AutoResearchClaw 拥有一个**成熟的、完整实现的技能系统**，包含以下组件：

#### 数据模型

```python
@dataclass
class Skill:
    name: str                    # "chemistry-rdkit"
    description: str             # 一行描述
    body: str                    # Markdown 正文（prompt 注入内容）
    license: str                 # 许可证
    compatibility: str           # 兼容性
    metadata: dict[str, str]      # category, trigger-keywords, applicable-stages, priority, version
    source_dir: Path | None
    source_format: str            # "skillmd" | "yaml"
```

#### SKILL.md 格式示例（chemistry-rdkit）

```markdown
---
name: chemistry-rdkit
description: Computational chemistry with RDKit...
metadata:
  category: domain
  trigger-keywords: "molecule,SMILES,chemical,drug,rdkit,..."
  applicable-stages: "9,10,12"
  priority: "4"
  version: "1.0"
---

## RDKit Cheminformatics Best Practice

### Molecular I/O
1. Create molecules from SMILES: `mol = Chem.MolFromSmiles('CCO')`
...
```

#### 技能分类（4 类，19 个内置）

| 类别 | 示例 |
|------|------|
| `domain` | biology-biopython, chemistry-rdkit, cv-classification, nlp-alignment |
| `experiment` | literature-search, hypothesis-formulation, experimental-design |
| `tooling` | data-loading, distributed-training, pytorch-training |
| `writing` | (元类别，当前无内置) |

#### 匹配引擎

```python
def match_skills(skills, context, stage, top_k=3):
    # 1. 阶段过滤: skill.applicable_stages 必须包含当前阶段
    # 2. 关键词匹配: trigger_keywords 与上下文 token 的交集评分
    # 3. 描述回退: 无 trigger_keywords 时用 description 做 0.5x 折扣匹配
    # 4. 优先级加权: priority 1→+0.5, priority 10→+0.0
```

#### 注入方式

```python
# SkillRegistry 导出格式化的 prompt 文本
def export_for_prompt(skills, max_chars=4000) -> str:
    # "### chemistry-rdkit (domain)\n{body content}\n..."

# 通过 PromptManager 的 evolution_overlay 参数注入
sp = prompts.for_stage(
    "experiment_design",
    topic=topic,
    evolution_overlay=skill_registry.export_for_prompt(matched_skills)
)
```

### 4.2 Claude Code Skill 系统

Claude Code 的 Skill 系统基于 `.claude/skills/<name>/SKILL.md` 文件：

```markdown
---
name: my-skill
description: Description of what this skill does
argument-hint: "Optional hint text for the user"
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - read_file
  - write_file
---

## Instructions
When this skill is activated, follow these rules...
```

**关键差异**：
- Claude Code Skill 可以声明 `allowed-tools`（限定技能可使用的工具）
- Claude Code Skill 可以 `user-invocable`（用户手动激活）或自动匹配
- Claude Code Skill 支持 `$ARGUMENTS` 变量替换

### 4.3 Skill 系统对比矩阵

| 特性 | AutoResearchClaw | Claude Code | FirmClaw（已设计） |
|------|-----------------|-------------|-------------------|
| **存储格式** | SKILL.md (YAML+MD) | SKILL.md (YAML+MD) | SKILL.md (YAML+MD) |
| **加载机制** | 自动扫描目录 | 自动扫描目录 | 自动扫描目录 |
| **匹配方式** | 关键词+阶段+优先级 | 用户手动 / 自动匹配 | 用户手动 / 关键词匹配 |
| **注入位置** | PromptManager evolution_overlay | System Prompt | System Prompt |
| **allowed-tools** | 不支持 | 支持 | 设计中支持 |
| **$ARGUMENTS** | 不支持 | 支持 | 设计中支持 |
| **禁用机制** | `enabled: false` | 删除/重命名 | 设计中支持 |
| **分类体系** | 4 类（writing/domain/experiment/tooling） | 无分类 | 2 类（通用/领域） |
| **内置技能** | 19 个 | 0 个（社区提供） | 0 个（待创建） |
| **自演化** | 支持（Lesson → Skill 转换） | 不支持 | 设计中支持 |

---

## 5. MCP 支持对比

### 5.1 AutoResearchClaw MCP（已实现，部分 Stub）

AutoResearchClaw 实现了完整的 MCP Client 和 Server 架构，但部分功能为 stub：

```
researchclaw/mcp/
├── client.py       # MCP 客户端（连接外部 MCP 服务器）
├── server.py       # MCP 服务端（暴露管道能力为工具）
├── registry.py     # MCP 服务器注册中心
├── tools.py        # 6 个 MCP Tool 定义
├── transport.py    # 传输层（Stdio 完整，SSE stub）
└── __init__.py
```

**暴露的 MCP 工具**：

| 工具 | 描述 |
|------|------|
| `run_pipeline` | 启动研究管道 |
| `get_pipeline_status` | 查询管道状态 |
| `get_experiment_results` | 获取实验结果 |
| `search_literature` | 搜索学术论文 |
| `review_paper` | AI 同行评审 |
| `get_paper` | 获取生成的论文 |

**MCP Client**：
- 支持 stdio 和 SSE 两种传输协议
- `_send_request()` 目前是 stub 实现（直接返回空结果）
- `MCPClient` 提供 `list_tools()`、`call_tool()`、`list_resources()`、`read_resource()`

**MCP 与适配器集成**：
- `AdapterBundle` 可将 `MessageAdapter` 和 `WebFetchAdapter` 替换为 MCP 后端实现
- 配置 `openclaw_bridge` 启用时自动切换

### 5.2 FirmClaw MCP（已设计，未实现）

根据 `docs/design-skill-mcp.md` 的设计：

```yaml
# .firmclaw/mcp-servers.yaml
servers:
  github:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

**关键设计**：
- MCP 外部工具通过适配器转换为 FirmClaw `Tool` 接口
- 注册到 `ToolRegistry` 后与内置工具无差异
- 命名规范 `mcp__<server>__<tool>`
- 自动继承 ToolRegistry 的权限策略、Hook 系统等安全层

### 5.3 关键差异

| 维度 | AutoResearchClaw | FirmClaw（设计） |
|------|-----------------|-----------------|
| **MCP 定位** | 既暴露自身能力（Server）也连接外部（Client） | 仅作为 Client 连接外部 |
| **工具适配** | 不适配（独立调用 `MCPClient.call_tool()`） | 适配为 `Tool` 接口，注册到 `ToolRegistry` |
| **安全集成** | 无（MCP 调用无权限控制） | 继承 FirmClaw 完整安全层 |
| **传输层** | Stdio（完整）+ SSE（stub） | 使用 `@modelcontextprotocol/sdk` |
| **配置格式** | 硬编码在 `adapters.py` | YAML 配置文件 |

---

## 6. AutoResearchClaw 功能矩阵分析

### 6.1 完整功能列表

| 功能模块 | 实现状态 | 复杂度 | FirmClaw 对应 |
|----------|---------|--------|--------------|
| **23 阶段管道** | 完整实现 | 高 | 无对应（不同架构） |
| **状态机（9 种状态）** | 完整实现 | 高 | 无（ReAct 循环） |
| **PIVOT/REFINE 回滚** | 完整实现 | 高 | 无对应 |
| **Skill 系统** | 完整实现 | 中 | 已设计未实现 |
| **MCP Server** | 架构完整（部分 stub） | 中 | 已设计未实现 |
| **MCP Client** | 架构完整（stub） | 中 | 已设计未实现 |
| **技能匹配引擎** | 完整实现 | 中 | 已设计未实现 |
| **技能加载器** | 完整实现（3 种格式） | 低 | 已设计未实现 |
| **19 个内置技能** | 完整实现 | 低 | 待创建 |
| **Lesson → Skill 转换** | 完整实现 | 中 | 已设计 |
| **实验沙盒（5 种）** | 完整实现 | 高 | bash Tool 部分 |
| **文献搜索（3 源）** | 完整实现 | 中 | 无对应 |
| **自演化系统** | 完整实现 | 中 | 无对应 |
| **ACP 多 Agent 集成** | 完整实现 | 高 | 无对应 |
| **MetaClaw 集成** | 完整实现 | 中 | 无对应 |
| **代码 Agent（3 后端）** | 完整实现 | 高 | 无对应（FirmClaw 本身就是 Agent） |
| **多 Agent 子系统** | 完整实现（3 个） | 高 | SubagentManager |
| **Prompt 外部化** | 完整实现 | 低 | 模板引擎 |
| **领域适配（20 个）** | 完整实现 | 中 | 无对应 |
| **OpenClaw Bridge** | 完整实现 | 中 | 无对应 |

### 6.2 可借鉴的设计

1. **Skill 数据模型**：`Skill` dataclass 的设计非常清晰，兼容 agentskills.io 规范
2. **SKILL.md 格式**：YAML frontmatter + Markdown body，标准且易读
3. **技能匹配算法**：关键词匹配 + 描述回退 + 优先级加权的多级评分
4. **`export_for_prompt()`**：将技能格式化为 prompt 注入文本，带字符预算控制
5. **多格式加载器**：SKILL.md > YAML > JSON 的优先级加载
6. **`enabled: false` 禁用机制**：简单实用的技能开关
7. **Stage-Skill 映射表**：`STAGE_SKILL_MAP` 将每个管道阶段映射到首选技能类别

---

## 7. FirmClaw 与 Claude Code Skill 系统的差异

### 7.1 核心差异

FirmClaw 作为 ReAct 智能体，其 Skill 系统与 Claude Code 的 Skill 系统存在以下根本差异：

| 维度 | Claude Code | FirmClaw |
|------|-------------|----------|
| **交互模式** | 用户在对话中激活 Skill | 用户在对话中激活 Skill |
| **Tool 集成** | Skill 可声明 `allowed-tools` | Skill 可声明 `allowed-tools` |
| **执行模型** | LLM 自主选择工具调用 | LLM 自主选择工具调用 |
| **参数传递** | `$ARGUMENTS` 变量替换 | `$ARGUMENTS` 变量替换 |
| **自动匹配** | 基于 description + context | 基于关键词 + description |

**结论**：FirmClaw 的 Skill 系统可以直接采用 Claude Code 的 SKILL.md 格式，因为两者都是 ReAct 智能体，交互模式天然兼容。

### 7.2 需要适配的部分

| Claude Code 特性 | FirmClaw 适配方案 |
|------------------|-------------------|
| `.claude/skills/` 目录 | `.firmclaw/skills/` 目录 |
| `user-invocable` 字段 | 保留，控制是否可通过 `/skill-name` 激活 |
| `disable-model-invocation` | 保留，控制是否可自动匹配 |
| `allowed-tools` | 通过 `ToolRegistry` 实现，执行时检查 |
| `argument-hint` | 保留，用户输入参数时的提示 |

### 7.3 FirmClaw 工具架构的优势

相比 Claude Code 和 AutoResearchClaw，FirmClaw 的 `ToolRegistry` 架构在以下方面更强：

1. **参数校验**：AJV JSON Schema 自动校验，Claude Code 无此机制
2. **权限策略**：文件路径白名单 + bash 命令审批
3. **Hook 系统**：Before/After Hooks 可拦截/修改工具调用
4. **Prompt Guard**：自动检测 prompt injection
5. **OpenAI 兼容**：原生 function calling 格式输出

这些安全层**自动应用于**所有通过 MCP 适配的外部工具，是 FirmClaw 架构的核心优势。

---

## 8. 三种实现方案对比

基于对三个项目的分析，以下是 FirmClaw 实现 Skill + MCP 的三种方案对比：

### 方案 A：轻量级集成（推荐）

**设计思路**：在现有 FirmClaw 架构上最小化添加 Skill 和 MCP 支持。

```
FirmClaw 现有架构          新增模块
┌────────────────┐     ┌──────────────┐
│ AgentLoop       │     │ SkillManager │
│ ├─ ContextBuilder│────▶│ ├─ SkillParser│
│ ├─ ToolRegistry  │     │ └─ Matcher    │
│ └─ SessionManager│     ├──────────────┤
└────────────────┘     │MCPClientMgr  │
                        │ ├─ ToolAdapter│
                        │ └─ Config     │
                        └──────────────┘
```

**新增文件**：
- `src/skills/types.ts`, `src/skills/skill-manager.ts`, `src/skills/skill-parser.ts`
- `src/mcp/types.ts`, `src/mcp/mcp-client-manager.ts`, `src/mcp/tool-adapter.ts`

**改动范围**：
- `context-builder.ts`：新增 `activeSkill` 参数，注入 skill prompt
- `agent-loop.ts`：新增 Skill 自动匹配逻辑
- `index.ts`：初始化 SkillManager 和 MCPClientManager

**优势**：改动最小，保持现有架构不变，MCP 工具自动继承安全层
**劣势**：Skill 功能相对简单，不支持 Skill 间组合

### 方案 B：深度集成

**设计思路**：Skill 系统深度集成到 Agent 循环中，Skill 可以定义自己的工具子集和执行流程。

**额外新增**：
- Skill 可定义子 Agent 流程（如 AutoResearchClaw 的 CodeAgent）
- Skill 可声明生命周期钩子（`on_activate`, `on_deactivate`）
- Skill 可引用其他 Skill（Skill 组合）

**优势**：功能最强，接近 AutoResearchClaw 的能力
**劣势**：改动大，复杂度高，需要大量重构

### 方案 C：插件架构

**设计思路**：引入完整的插件系统，Skill 和 MCP Server 都作为插件加载。

**额外新增**：
- 插件生命周期管理
- 插件依赖解析
- 插件沙箱隔离
- 插件市场/仓库

**优势**：最灵活，社区生态潜力大
**劣势**：工程量最大，与现有架构冲突最多

### 方案对比表

| 维度 | 方案 A（推荐） | 方案 B（深度） | 方案 C（插件） |
|------|-------------|--------------|--------------|
| **改动量** | ~6 新文件 + 3 修改 | ~12 新文件 + 10 修改 | ~20 新文件 + 15 修改 |
| **Skill 互操作性** | Claude Code 兼容 | Claude Code + AutoResearchClaw | 全部兼容 |
| **MCP 安全集成** | 自动继承 ToolRegistry | 自动继承 | 需额外适配 |
| **开发时间** | ~1-2 周 | ~3-4 周 | ~6-8 周 |
| **复杂度风险** | 低 | 中 | 高 |
| **可扩展性** | 中 | 高 | 最高 |

---

## 9. Skill + MCP 扩展性设计建议

基于 AutoResearchClaw 的经验教训，以下是 FirmClaw Skill + MCP 的扩展性设计建议：

### 9.1 SKILL.md 格式规范

建议采用 AutoResearchClaw 和 Claude Code 的共同标准，扩展少量 FirmClaw 特有字段：

```markdown
---
name: python-testing
description: Python testing best practices with pytest
argument-hint: "Optional: specify testing framework preference"
user-invocable: true
allowed-tools:
  - read_file
  - write_file
  - bash
disable-model-invocation: false

# FirmClaw 扩展字段
skill-version: "1.0"
tags: ["python", "testing", "quality"]
---

## Python Testing Best Practices

### Test Structure
1. Use `tests/` directory for test files
2. Name test files `test_<module>.py`
3. Group related tests in classes

### Usage
When asked about testing, follow these rules:
$ARGUMENTS
```

### 9.2 技能匹配算法建议

建议融合 AutoResearchClaw 的多级匹配和 Claude Code 的上下文匹配：

```typescript
async function matchSkill(context: string, skills: Skill[], topK: number): Promise<Skill[]> {
  const scored: Array<{ score: number; skill: Skill }> = [];
  
  for (const skill of skills) {
    // 1. 关键词精确匹配 (权重 1.0)
    const keywordScore = matchKeywords(skill.metadata['trigger-keywords'], context);
    
    // 2. 描述语义匹配 (权重 0.5)
    const descScore = matchDescription(skill.description, context);
    
    // 3. 优先级加权
    const priorityBoost = (10 - (skill.metadata.priority || 5)) / 20;
    
    // 4. 标签匹配 (权重 0.3)
    const tagScore = matchTags(skill.tags || [], context);
    
    const totalScore = keywordScore + descScore * 0.5 + priorityBoost + tagScore * 0.3;
    if (totalScore > 0) scored.push({ score: totalScore, skill });
  }
  
  return scored.sort((a, b) => b.score - a.score).slice(0, topK).map(s => s.skill);
}
```

### 9.3 MCP 工具适配最佳实践

基于 AutoResearchClaw 的经验，MCP 工具适配应注意：

1. **命名冲突**：使用 `mcp__<server>__<tool>` 三段式命名，避免与内置工具冲突
2. **超时控制**：MCP 工具调用必须设置超时，避免无限等待
3. **错误降级**：MCP Server 断开时优雅降级，不影响其他功能
4. **懒加载**：MCP Server 按需启动，不随 FirmClaw 启动全部加载
5. **状态同步**：连接/断开事件通知用户

### 9.4 自演化建议

AutoResearchClaw 的 MetaClaw 集成（Lesson → Skill 自动转换）是一个值得借鉴的设计方向：

```
Agent 执行失败
     │
     ▼
提取 Lesson（失败原因 + 上下文）
     │
     ▼
┌─────────────────┐
│ LLM 生成 Skill  │ ← 需要 LLM 调用，有一定成本
│ (Lesson→Skill)  │
└────────┬────────┘
         │
         ▼
保存到 .firmclaw/skills/auto/
         │
         ▼
下次自动匹配注入
```

FirmClaw 可以在 **AgentLoop** 中添加类似的 Lesson 提取逻辑：当工具调用连续失败时，自动提取失败模式并生成避免建议 Skill。

---

## 10. 结论与建议

### 10.1 FirmClaw 架构评估

| 评估维度 | 评分 | 说明 |
|----------|------|------|
| 工具系统完备性 | ★★★★★ | 统一接口 + 参数校验 + 权限 + Hook + PromptGuard |
| 安全性 | ★★★★★ | 多层安全防护，远超对比项目 |
| OpenAI 兼容性 | ★★★★★ | 原生 function calling 支持 |
| Skill 支持 | ★☆☆☆☆ | 未实现（已有设计方案） |
| MCP 支持 | ★☆☆☆☆ | 未实现（已有设计方案） |
| 自演化 | ★☆☆☆☆ | 无 |
| 领域扩展 | ★★☆☆☆ | 仅通过 Tool 扩展 |

### 10.2 关键结论

1. **FirmClaw 的工具架构远超 AutoResearchClaw**：统一的 `Tool` 接口、参数校验、权限策略、Hook 系统是 AutoResearchClaw 不具备的。MCP 工具适配到 `ToolRegistry` 后将自动获得这些安全能力。

2. **Skill 系统可直接兼容 Claude Code**：FirmClaw 和 Claude Code 都是 ReAct 智能体，SKILL.md 格式和注入方式可以直接对齐。AutoResearchClaw 的 Skill 系统是为管道设计的（按阶段匹配），不适合直接照搬。

3. **推荐方案 A（轻量级集成）**：改动最小（~6 个新文件 + 3 个修改），1-2 周可完成，且完全兼容 Claude Code Skill 格式。MCP 工具自动继承 FirmClaw 的完整安全层。

4. **AutoResearchClaw 最大的可借鉴价值**：
   - SKILL.md 格式规范（agentskills.io 兼容）
   - 技能匹配算法（多级评分）
   - Lesson → Skill 自演化机制

5. **不需要照搬 AutoResearchClaw 的管道架构**：FirmClaw 作为通用智能体，不需要 `Stage`/`StageContract`/`PIVOT/REFINE` 等管道概念。两者解决不同的问题——FirmClaw 是"万能钥匙"，AutoResearchClaw 是"论文工厂"。

### 10.3 下一步行动建议

按照 `docs/design-skill-mcp.md` 中已有的设计方案，分三阶段实施：

**Phase 1（基础）**：Skill 类型定义 + SkillManager + SkillParser
**Phase 2（集成）**：ContextBuilder 注入 + AgentLoop 自动匹配
**Phase 3（扩展）**：MCP Client + 工具适配 + 自演化

> 详见已有设计文档：`docs/design-skill-mcp.md`
