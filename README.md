<div align="center">

# FirmClaw

**本地优先的 AI Agent 框架 — 从零构建，完全可控**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-7.0.0-green.svg)]()

一个基于 **ReAct 架构**的本地优先 AI 智能体框架。灵感来源于 Claude Code / OpenClaw，从零搭建，核心仅 6 个外部依赖，零原生模块依赖。

</div>

---

## 为什么选择 FirmClaw？

| 特性 | FirmClaw | 其他 Agent 框架 |
|:---|:---:|:---:|
| 完全本地运行 | [x] | 部分依赖云服务 |
| 数据不出本机 | [x] | 通常需要 API |
| 可切换任意 LLM | [x] | 绑定特定模型 |
| 代码完全可控 | [x] | 黑盒或重度抽象 |
| 外部依赖极少 | 6 个 | 通常 20+ |
| 工具安全防护 | 5 层 | 通常 1-2 层 |
| Skill + MCP 扩展 | [x] | 少数支持 |
| 离线部署 | [x] | 通常不支持 |

---

## 核心能力

### ReAct 智能体引擎

FirmClaw 的核心是一个不断迭代的 **"思考-行动-观察"** 循环：

```
用户输入 → LLM 推理 → 工具调用 → 观察结果 → 继续推理 → ... → 最终回答
```

LLM 自主决定何时调用哪个工具、调用几次，具备真正的自主行动能力。

### 6 大内置工具

| 工具 | 功能 | 安全策略 |
|:---|:---|:---|
| `bash` | 执行终端命令 | 只读命令自动放行，删除命令需人工审批 |
| `read_file` | 读取文件（支持分段） | 低风险，自动放行 |
| `write_file` | 创建/覆写文件 | 中风险，按策略决定 |
| `edit_file` | 精确编辑文件（唯一性校验） | 中风险，按策略决定 |
| `web_search` | 联网搜索（Bing/DuckDuckGo） | SSRF 防护 + 结果缓存 |
| `web_fetch` | 抓取网页正文 | SSRF 防护 + 超时保护 + 内容截断 |

### 5 层安全防护

```
1. JSON Schema 参数校验（ajv）
2. Before/After Hook 拦截
3. 路径白名单 + 命令黑名单
4. 人工审批网关（Human-in-the-Loop）
5. Prompt Injection 防护（自动标记净化）
```

### Skill 技能系统

兼容 Claude Code 的 `SKILL.md` 格式，支持领域知识注入：

```markdown
<!-- .claude/skills/my-skill/SKILL.md -->
---
name: python-testing
description: Python testing best practices with pytest
user-invocable: true
---

## Python Testing Best Practices
1. Use `tests/` directory
2. Name test files `test_<module>.py`
...
```

- **自动匹配**：根据用户输入的关键词自动激活相关技能
- **手动激活**：通过 `/skill <name>` 命令手动调用
- **MCP 联动**：技能可声明依赖的 MCP Server，激活时自动连接

### MCP 协议扩展

通过 Model Context Protocol 连接外部工具服务器，无缝扩展能力：

```yaml
# .firmclaw/mcp-servers.yaml
servers:
  github:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

- 支持 **stdio** 和 **SSE** 两种传输协议
- MCP 工具自动注册到内置 ToolRegistry，**继承全部安全防护**
- 工具命名格式：`mcp__<server>__<tool>`

### 多客户端网关

```bash
# CLI 模式
> npm run dev

# WebSocket 服务 + Web UI
> /serve 3000
```

- **JSON-RPC 2.0** 协议，双向实时通信
- **Web UI**：内置聊天界面，支持 Markdown 渲染
- **子智能体**：主智能体可将任务拆分给子智能体并行执行

### 智能记忆系统

- **会话管理**：JSONL 持久化，支持多轮对话、会话恢复、分支
- **长期记忆**：结构化 Markdown（偏好/决策/待办/知识），自动分类
- **全文搜索**：纯 JS BM25 算法，跨会话信息检索
- **LLM 摘要压缩**：80,000 token 阈值自动触发，压缩率 93%+

---

## 快速开始

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/your-username/FirmClaw.git
cd FirmClaw

# 2. 安装依赖
npm install

# 3. 配置 LLM API
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 4. 启动
npm run dev
```

### 配置 LLM（任选其一）

在 `.env` 文件中配置：

```bash
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

| 提供商 | BASE_URL | 模型示例 |
|:---|:---|:---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| Claude | `https://api.anthropic.com/v1` | `claude-3.5-sonnet` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| MiniMax | `https://api.minimax.chat/v1` | `MiniMax-M2.7` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2-7B-Instruct` |
| Ollama (本地) | `http://localhost:11434/v1` | `llama3`, `qwen2` |

---

## 使用示例

### CLI 交互

```
FirmClaw v7.0.0
Model: gpt-4o-mini
API: https://api.openai.com/v1
WorkDir: /your/project
Type "/help" for commands, "exit" to quit.

> 帮我分析这个项目的架构
  [thinking] 让我先看看项目的文件结构...
  [bash] {"command": "find . -name '*.ts' -type f | head -20"}
  [bash] 50 files found (120ms)
  [read_file] {"path": "src/index.ts"}
  [read_file] (456 lines) (15ms)
  ...
  根据分析，这个项目的核心架构如下：
  ## 架构概览
  - **AgentLoop**: ReAct 循环核心
  - **ToolRegistry**: 工具注册中心
  ...
  [3 turns, 5 tool calls]
```

### 常用命令

| 命令 | 说明 |
|:---|:---|
| `/new` | 创建新会话 |
| `/resume [id]` | 恢复会话 |
| `/sessions` | 列出所有会话 |
| `/memory [tag]` | 查看记忆（偏好/决策/待办/知识） |
| `/remember <text>` | 保存一条记忆 |
| `/search <query>` | 全文搜索（跨会话） |
| `/compact` | 手动触发上下文压缩 |
| `/skill-list` | 列出可用技能 |
| `/skill <name>` | 手动激活技能 |
| `/mcp-list` | 查看 MCP 状态 |
| `/serve [port]` | 启动 WebSocket + Web UI |
| `/help` | 显示帮助 |

---

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    多客户端接入层                         │
│    CLI  │  Web UI  │  VS Code 插件  │  curl / wscat      │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│              FirmClaw Agent Runtime                      │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │AgentLoop  │  │SkillManager  │  │MCPClientManager  │   │
│  │(ReAct 核心)│  │(技能注入)     │  │(外部工具扩展)     │   │
│  └─────┬────┘  └──────────────┘  └──────────────────┘   │
│        │                                                 │
│  ┌─────┴──────────────────────────────────────────┐      │
│  │               ToolRegistry                        │      │
│  │  bash │ read │ write │ edit │ web_search │ web_fetch│   │
│  └─────┬──────────────────────────────────────────┘      │
│        │                                                 │
│  ┌─────┴──────────────────────────────────────────┐      │
│  │  安全层：校验 → Hook → 权限 → 审批 → 扫描       │      │
│  └───────────────────────────────────────────────┘      │
│                                                          │
│  SessionManager │ MemoryManager │ SearchEngine          │
│  Summarizer     │ Heartbeat     │ EventStream           │
└─────────────────────────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                 大语言模型 (LLM)                          │
│  GPT │ Claude │ DeepSeek │ MiniMax │ 通义千问 │ 本地模型  │
└─────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
src/
├── agent/                  # ReAct 循环 + 安全 + 子智能体
├── audit/                  # 审计日志
├── cli/                    # CLI 富文本渲染
├── gateway/                # WebSocket 网关 + Web UI
├── llm/                    # LLM 客户端（OpenAI 兼容）
├── mcp/                    # MCP 客户端
├── session/                # 会话管理 + 记忆 + 搜索
├── skills/                 # Skill 技能系统
├── tools/                  # 工具系统（bash/read/write/edit/web）
├── utils/                  # 基础设施（事件流/token计数/模板）
├── web/                    # 搜索引擎（Bing/DuckDuckGo）
└── tests/                  # 32 个测试文件
```

---

## 版本历程

| 版本 | 里程碑 | 主要特性 |
|:---|:---|:---|
| **v7.0** | 扩展生态 | Skill 技能系统 + MCP 客户端 + 联网搜索 |
| **v6.0** | 平台化 | WebSocket 网关 + 子智能体 + Web UI |
| **v5.0** | 生产就绪 | 人工审批 + 审计日志 + 心跳 + 会话分支 + Hook |
| **v4.0** | 智能记忆 | LLM 摘要压缩 + 记忆管理 + BM25 全文搜索 |
| **v3.0** | 多轮对话 | 会话管理 + 动态系统提示词 + 上下文窗口 |
| **v2.0** | 工具完善 | read/write/edit + 权限策略 + JSON Schema 校验 |
| **v1.0** | 最小可用 | ReAct 循环 + bash 工具 + CLI |

---

## 部署

### 在线部署

```bash
npm install && npm run build && node dist/index.js
```

### 离线部署（无网络环境）

项目提供约 14MB 的离线部署包：

1. 解压 `offline-bundle.zip`
2. 复制 `.env.example` 为 `.env`，填入 LLM API 配置
3. `node dist/index.js`

### Docker

```bash
docker build -t firmclaw .
docker run -it --env-file .env firmclaw
```

---

## 技术选型

| 组件 | 选型 | 理由 |
|:---|:---|:---|
| 语言 | TypeScript + Node.js | 生态丰富，Claude Code 同款 |
| LLM 接入 | OpenAI 兼容 SDK | 一套代码适配所有模型提供商 |
| 存储 | JSONL 文件 | 本地优先，append-only |
| 参数校验 | ajv | JSON Schema 标准校验 |
| 实时通信 | ws | 轻量标准 WebSocket |
| 全文搜索 | 纯 JS BM25 | 零原生依赖 |
| 安全防护 | 正则 + 权限策略 | 零成本 Prompt Injection 防护 |

**外部依赖仅 6 个**：`openai`、`ajv`、`dotenv`、`tsx`、`typescript`、`ws`

---

## 许可证

[MIT](./LICENSE)
