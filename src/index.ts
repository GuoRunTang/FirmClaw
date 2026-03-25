/**
 * src/index.ts
 *
 * 【讲解】
 * 这是程序的入口文件，负责：
 * 1. 加载环境变量（API Key 等）
 * 2. 初始化所有组件（LLM Client、Tool Registry、Agent Loop）
 * 3. 订阅事件流，将智能体的内部活动展示给用户
 * 4. 启动命令行交互循环（readline）
 *
 * 程序启动流程：
 *   加载 .env → 创建 LLM Client → 注册工具 → 创建 Agent → 订阅事件 → 等待用户输入
 *
 * 交互流程：
 *   用户输入 → agent.run(input) → 事件流实时展示 → 输出统计 → 等待下一次输入
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import { LLMClient } from './llm/client.js';
import { ToolRegistry } from './tools/registry.js';
import { bashTool } from './tools/bash.js';
import { AgentLoop } from './agent/agent-loop.js';

// ═══════════════════════════════════════════════════════════════
// 系统提示词 —— 定义智能体的身份和行为规则
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `你是一个本地 AI 智能体助手，可以执行终端命令来帮助用户完成任务。

## 工作方式
1. 理解用户的需求
2. 使用 bash 工具执行必要的命令来获取信息或完成任务
3. 根据命令输出分析结果
4. 给出清晰、有用的最终答案

## 注意事项
- 在执行命令前，先说明你打算做什么
- 如果命令执行失败，分析错误原因并尝试其他方法
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

  console.log(`FirmClaw v1.0.0`);
  console.log(`Model: ${model}`);
  console.log(`API: ${baseURL}`);
  console.log('Type "exit" to quit.\n');

  // ──── 2. 初始化组件 ────
  const llm = new LLMClient(apiKey, baseURL, model);

  const tools = new ToolRegistry();
  tools.register(bashTool);

  const agent = new AgentLoop(llm, tools, {
    systemPrompt: SYSTEM_PROMPT,
    maxTurns: 10, // 最多 10 轮循环
  });

  // ──── 3. 订阅事件流 ────
  const events = agent.getEvents();

  // LLM 生成文本时 → 实时输出
  events.on('thinking_delta', (e) => {
    process.stdout.write(e.data as string);
  });

  // 工具开始执行 → 显示工具名和参数
  events.on('tool_start', (e) => {
    const data = e.data as { toolName: string; args: Record<string, unknown> };
    console.log(`\n>>> [${data.toolName}] ${JSON.stringify(data.args)}`);
  });

  // 工具执行完成 → 显示结果（截断到 300 字符）
  events.on('tool_end', (e) => {
    const data = e.data as { toolName: string; result: string };
    const preview = data.result.length > 300
      ? data.result.substring(0, 300) + '...(truncated)'
      : data.result;
    console.log(`<<< [${data.toolName}] ${preview}`);
  });

  // 出错 → 显示错误
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

      // 退出
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\nBye!');
        rl.close();
        return;
      }

      // 空输入跳过
      if (!trimmed) {
        prompt();
        return;
      }

      console.log(''); // 空行分隔

      try {
        const result = await agent.run(trimmed);
        console.log(`\n--- [${result.turns} turns, ${result.toolCalls} tool calls] ---\n`);
      } catch (error: unknown) {
        console.error(`\n[Fatal Error] ${error instanceof Error ? error.message : String(error)}\n`);
      }

      prompt(); // 继续下一轮
    });
  };

  prompt();
}

main();
