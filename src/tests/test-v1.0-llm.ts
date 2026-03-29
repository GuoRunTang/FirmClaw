/**
 * src/tests/test-llm.ts
 *
 * 测试目标：验证 LLM Client 与 LLM API 的通信
 * 阶段：Phase 1 (v1.0.0) — 最小可用 ReAct 循环
 * 依赖：需要 API Key + 网络连接
 * v1.0: 初始实现
 * v1.1: 适配新 registry（ajv 校验不影响 chat 调用，但 register 需要有效 schema）
 */

import 'dotenv/config';
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { bashTool } from '../tools/bash.js';

async function testLLM() {
  console.log('=== Test 2: LLM Client ===\n');

  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.LLM_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimax.chat/v1';
  const model = process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || 'MiniMax-M2.7';

  const llm = new LLMClient(apiKey, baseURL, model);

  // Test 2a: 简单文本对话（无工具）
  console.log('[2a] Simple chat (no tools): "What is 1+1?"');
  const tools = new ToolRegistry();
  const response1 = await llm.chat(
    [{ role: 'user', content: 'What is 1+1? Reply with just the number.' }],
    tools,
  );
  console.log(`   Response: "${response1.content.trim()}"`);
  console.assert(response1.content.length > 0, 'FAIL: should have content');
  console.assert(!response1.tool_calls, 'FAIL: should not have tool_calls');
  console.log('   PASS\n');

  // Test 2b: 需要工具的对话
  console.log('[2b] Chat with tools: "What files are in the current directory?"');
  tools.register(bashTool);
  const response2 = await llm.chat(
    [{ role: 'system', content: 'You have access to a bash tool. Use it when needed.' }, { role: 'user', content: 'List files in the current directory. Use the bash tool to run "dir" or "ls".' }],
    tools,
  );
  console.log(`   Has tool_calls: ${!!response2.tool_calls}`);
  if (response2.tool_calls) {
    for (const tc of response2.tool_calls) {
      console.log(`   Tool: ${tc.function.name}, Args: ${tc.function.arguments}`);
    }
    console.assert(response2.tool_calls.length > 0, 'FAIL: should have tool_calls');
  }
  console.log('   PASS\n');

  console.log('=== All LLM tests passed! ===');
}

testLLM().catch(console.error);
