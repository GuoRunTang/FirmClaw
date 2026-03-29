/**
 * src/tests/test-agent.ts
 *
 * 测试目标：验证完整的 Agent Loop（ReAct 循环）
 * 阶段：Phase 1 (v1.0.0) — 最小可用 ReAct 循环
 * 依赖：需要 API Key + 网络连接
 * v1.0: 初始实现（基础 ReAct 循环）
 * v1.1: AgentConfig 新增 workDir
 */

import 'dotenv/config';
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { bashTool } from '../tools/bash.js';
import { AgentLoop } from '../agent/agent-loop.js';

async function testAgent() {
  console.log('=== Test 3: Full Agent Loop (ReAct) ===\n');

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.LLM_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimax.chat/v1';
  const model = process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || 'MiniMax-M2.7';

  const llm = new LLMClient(apiKey, baseURL, model);
  const tools = new ToolRegistry();
  tools.register(bashTool);

  const agent = new AgentLoop(llm, tools, {
    systemPrompt: 'You are a helpful assistant with access to a bash tool. Reply concisely in Chinese.',
    maxTurns: 5,
    workDir: process.cwd(),
  });

  // 订阅事件
  const events = agent.getEvents();
  events.on('thinking_delta', (e) => process.stdout.write(e.data as string));
  events.on('tool_start', (e) => {
    const d = e.data as { toolName: string; args: unknown };
    console.log(`\n>>> [${d.toolName}] ${JSON.stringify(d.args)}`);
  });
  events.on('tool_end', (e) => {
    const d = e.data as { result: string };
    console.log(`<<< ${d.result.substring(0, 200)}${d.result.length > 200 ? '...' : ''}`);
  });
  events.on('error', (e) => console.error(`\n[Error] ${e.data}`));

  // Test 3a: 需要调工具的任务
  console.log('[3a] Task: "What is the current date and time? Use the date command."');
  console.log('---');
  const result1 = await agent.run('What is the current date and time? Use the date command.');
  console.log('\n---');
  console.log(`   Turns: ${result1.turns}, Tool calls: ${result1.toolCalls}`);
  console.log(`   Final text: "${result1.text.substring(0, 100)}"`);
  console.assert(result1.turns >= 1, 'FAIL: should have at least 1 turn');
  console.log('   PASS\n');

  // Test 3b: 简单问题（不需要工具）
  console.log('[3b] Task: "What is 2+3?"');
  console.log('---');
  const result2 = await agent.run('What is 2+3? Reply with just the number.');
  console.log('\n---');
  console.log(`   Turns: ${result2.turns}, Tool calls: ${result2.toolCalls}`);
  console.log(`   Final text: "${result2.text.trim()}"`);
  console.assert(result2.turns === 1, 'FAIL: should be 1 turn (no tool needed)');
  console.log('   PASS\n');

  console.log('=== All Agent tests passed! ===');
}

testAgent().catch(console.error);
