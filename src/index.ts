/**
 * src/index.ts
 *
 * 程序入口文件。
 *
 * v1.3: 注册 bash + read_file + write_file 工具
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import { LLMClient } from './llm/client.js';
import { ToolRegistry } from './tools/registry.js';
import { bashTool } from './tools/bash.js';
import { readTool } from './tools/read.js';
import { writeTool } from './tools/write.js';
import { AgentLoop } from './agent/agent-loop.js';

// ═══════════════════════════════════════════════════════════════
// 系统提示词
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `你是一个本地 AI 智能体助手，可以读取/写入文件和执行终端命令来帮助用户完成任务。

## 可用工具
- **bash**: 执行终端命令（如 ls、cat、npm run 等）
- **read_file**: 读取文件内容，支持 offset/limit 分段读取，返回带行号的内容
- **write_file**: 创建或覆写文件，自动创建父目录

## 工作方式
1. 理解用户的需求
2. 优先使用 read_file 读取文件（比 bash cat 更精确）
3. 使用 write_file 创建或修改文件
4. 使用 bash 执行命令来获取动态信息或完成任务
5. 根据结果分析并给出清晰的最终答案

## 注意事项
- 在执行操作前，先说明你打算做什么
- 如果操作失败，分析错误原因并尝试其他方法
- 使用中文回复
- 回答要简洁直接，不要多余的客套话`;

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  // ──── 1. 加载配置 ────
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL || 'https://api.minimax.chat/v1';
  const model = process.env.LLM_MODEL || 'MiniMax-M2.7';

  if (!apiKey) {
    console.error('Error: LLM_API_KEY is not set in .env file.');
    process.exit(1);
  }

  console.log(`FirmClaw v1.1.0`);
  console.log(`Model: ${model}`);
  console.log(`API: ${baseURL}`);
  console.log(`WorkDir: ${process.cwd()}`);
  console.log('Type "exit" to quit.\n');

  // ──── 2. 初始化组件 ────
  const llm = new LLMClient(apiKey, baseURL, model);

  const tools = new ToolRegistry();
  tools.register(bashTool);
  tools.register(readTool);
  tools.register(writeTool);

  const agent = new AgentLoop(llm, tools, {
    systemPrompt: SYSTEM_PROMPT,
    maxTurns: 10,
    workDir: process.cwd(),
  });

  // ──── 3. 订阅事件流 ────
  const events = agent.getEvents();

  events.on('thinking_delta', (e) => {
    process.stdout.write(e.data as string);
  });

  events.on('tool_start', (e) => {
    const data = e.data as { toolName: string; args: Record<string, unknown> };
    console.log(`\n>>> [${data.toolName}] ${JSON.stringify(data.args)}`);
  });

  events.on('tool_end', (e) => {
    const data = e.data as { toolName: string; result: string };
    const preview = data.result.length > 300
      ? data.result.substring(0, 300) + '...(truncated)'
      : data.result;
    console.log(`<<< [${data.toolName}] ${preview}`);
  });

  events.on('error', (e) => {
    console.error(`\n[Error] ${e.data}`);
  });

  // ──── 4. 启动命令行交互 ────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question('> ', async (input: string) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\nBye!');
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      console.log('');

      try {
        const result = await agent.run(trimmed);
        console.log(`\n--- [${result.turns} turns, ${result.toolCalls} tool calls] ---\n`);
      } catch (error: unknown) {
        console.error(`\n[Fatal Error] ${error instanceof Error ? error.message : String(error)}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
