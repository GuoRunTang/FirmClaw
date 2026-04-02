# FirmClaw

基于 ReAct 架构的本地优先 AI Agent 框架。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 LLM

复制环境变量示例文件并修改配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置你的 LLM API：

| 变量 | 说明 | 示例 |
|------|------|------|
| `LLM_API_KEY` | API 密钥 | `sk-xxx` |
| `LLM_BASE_URL` | API 基础 URL | `https://api.openai.com/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-4o-mini` |

支持的 LLM 提供商（任选其一）：

| 提供商 | BASE_URL | 模型示例 |
|--------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| MiniMax | `https://api.minimax.chat/v1` | `MiniMax-M2.7` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2-7B-Instruct` |
| Ollama (本地) | `http://localhost:11434/v1` | `llama3`, `qwen2` |

### 3. 运行

```bash
# 开发模式
npm run dev

# 构建后运行
npm run build
node dist/index.js
```

## 使用

启动后输入消息与 AI 对话：

```
FirmClaw v6.0.0
Model: gpt-4o-mini
API: https://api.openai.com/v1
WorkDir: D:\code\FirmClaw
Type "/help" for commands, "exit" to quit.

> 你好，请介绍一下你自己
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `/new` | 创建新会话 |
| `/resume` | 恢复上次会话 |
| `/sessions` | 列出所有会话 |
| `/serve [port]` | 启动 WebSocket 服务器 |
| `/help` | 显示帮助 |

### Web UI 启动

```bash
# 在 CLI 中运行
/serve 3000
```

然后访问 http://localhost:3000

## 部署

### 生产构建

```bash
npm run build
```

构建产物在 `dist/` 目录。

### 部署到服务器

1. 复制项目文件到服务器
2. 运行 `npm install --production`
3. 配置 `.env` 文件
4. 使用 `node dist/index.js` 启动

### Docker 部署（可选）

创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
```

构建运行：

```bash
docker build -t firmclaw .
docker run -it --env-file .env firmclaw
```

## 配置说明

### 环境变量优先级

1. 系统环境变量（最高）
2. `.env` 文件
3. 代码默认值

### 可用工具

- `bash` - 执行 Shell 命令
- `read` - 读取文件
- `write` - 写入文件
- `edit` - 编辑文件
- `web-search` - 网络搜索
- `web-fetch` - 获取网页内容

## 许可证

MIT
