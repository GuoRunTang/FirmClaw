/**
 * src/tests/test-token-counter.ts
 *
 * 测试目标：验证 TokenCounter（token 估算 + 消息裁剪）
 * 阶段：Phase 3 (v2.3.0) — 上下文窗口管理
 * 依赖：无（不需要 API Key，不需要网络）
 *
 * 测试用例：
 * - 中文/英文 token 估算、空文本边界、带 tool_calls 的消息、
 *   空消息裁剪、未超限不裁剪、tool 消息截断、整体裁剪、
 *   system + 首条 user 保护规则、裁剪报告正确性
 */

import { TokenCounter } from '../utils/token-counter.js';
import type { Message } from '../llm/client.js';

// ═══════════════════════════════════════════════════════
// 测试工具
// ═══════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ ${testName}`);
  }
}

// ═══════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════

async function testCountTextChinese() {
  const counter = new TokenCounter();
  // 8 个中文字符 ≈ 2 token
  const tokens = counter.countText('你好世界测试数据');
  assert(tokens === 2, `中文估算 → 8字符=${tokens} tokens (期望≈2)`);
}

async function testCountTextEnglish() {
  const counter = new TokenCounter();
  // 16 个英文字符 ≈ 4 token
  const text16 = '0123456789abcdef';
  const tokens = counter.countText(text16);
  assert(tokens === 4, `英文估算 → 16字符=${tokens} tokens (期望=4)`);
}

async function testCountTextEmpty() {
  const counter = new TokenCounter();
  assert(counter.countText('') === 0, '空文本 → 0 token');
}

async function testCountMessage() {
  const counter = new TokenCounter();
  const msg: Message = { role: 'user', content: '这是一条测试消息' };
  const tokens = counter.countMessage(msg);
  assert(tokens > 0, '消息估算 → token 数大于 0');
}

async function testCountMessageWithToolCalls() {
  const counter = new TokenCounter();
  const msg: Message = {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'bash', arguments: '{"command":"ls"}' },
    }],
  };
  const tokensWithTools = counter.countMessage(msg);
  const msgNoTools: Message = { role: 'assistant', content: '' };
  const tokensNoTools = counter.countMessage(msgNoTools);
  assert(tokensWithTools > tokensNoTools, '带 tool_calls 的消息 → token 更多');
}

async function testCountMessages() {
  const counter = new TokenCounter();
  const messages: Message[] = [
    { role: 'system', content: '系统提示词' },
    { role: 'user', content: '用户消息' },
    { role: 'assistant', content: '助手回复' },
  ];
  const total = counter.countMessages(messages);
  assert(total > 0, '消息列表估算 → token 数大于 0');
  assert(total === counter.countMessage(messages[0]) + counter.countMessage(messages[1]) + counter.countMessage(messages[2]),
    '消息列表估算 → 等于各消息之和');
}

async function testTrimEmptyMessages() {
  const counter = new TokenCounter();
  const result = counter.trimMessages([]);
  assert(result.messages.length === 0, '空消息 → 返回空数组');
  assert(result.originalTokens === 0, '空消息 → 0 original tokens');
  assert(result.removedCount === 0, '空消息 → 0 removed');
}

async function testTrimNoOpWhenUnderLimit() {
  const counter = new TokenCounter();
  const messages: Message[] = [
    { role: 'system', content: '简短的系统提示' },
    { role: 'user', content: '简短的用户消息' },
  ];
  const result = counter.trimMessages(messages, { maxTokens: 100000 });
  assert(result.messages.length === 2, '未超限 → 消息数量不变');
  assert(result.removedCount === 0, '未超限 → 未移除任何消息');
}

async function testTrimToolMessageTruncation() {
  const counter = new TokenCounter();
  // 创建一个超长 tool 消息（2000 字符 ≈ 500 token）
  const longContent = 'x'.repeat(2000);
  const messages: Message[] = [
    { role: 'system', content: '系统提示词' },
    { role: 'user', content: '请执行命令' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
    { role: 'tool', content: longContent, tool_call_id: 'c1' },
  ];

  const result = counter.trimMessages(messages, { maxToolResultTokens: 50 });
  // tool 消息应被截断
  assert(result.truncatedCount === 1, `长 tool 消息 → 被截断 (实际 ${result.truncatedCount})`);
  assert(result.messages[3].content.includes('...(truncated)'), '截断后 → 包含 ...(truncated)');
  assert(result.messages[3].content.length < longContent.length, '截断后 → 内容变短');
}

async function testTrimOverallRemoval() {
  const counter = new TokenCounter();

  // 创建大量消息超过 100 token 限制
  const messages: Message[] = [
    { role: 'system', content: '系统' },
    { role: 'user', content: '第一条用户消息，这条会被保留' },
  ];

  // 添加大量 assistant + tool 消息对
  for (let i = 0; i < 20; i++) {
    messages.push({ role: 'assistant', content: `助手回复 ${i}` });
    messages.push({ role: 'tool', content: `工具结果 ${i}: ${'数据'.repeat(50)}` });
  }
  messages.push({ role: 'user', content: '最后的用户消息' });

  const result = counter.trimMessages(messages, { maxTokens: 100, maxToolResultTokens: 100 });
  assert(result.removedCount > 0, `总 token 超限 → 移除了消息 (实际 ${result.removedCount})`);
  assert(result.trimmedTokens <= 100, `裁剪后 → token 不超限 (实际 ${result.trimmedTokens})`);
}

async function testTrimProtectsSystemAndFirstUser() {
  const counter = new TokenCounter();

  const messages: Message[] = [
    { role: 'system', content: '系统提示词' },
    { role: 'user', content: '第一条用户消息' },
  ];

  // 添加很多中间消息
  for (let i = 0; i < 50; i++) {
    messages.push({ role: 'assistant', content: `回复 ${i}` });
  }

  const result = counter.trimMessages(messages, { maxTokens: 10 });
  // system 和第一条 user 必须保留
  assert(result.messages.length >= 2, `保护规则 → 至少保留 2 条消息 (实际 ${result.messages.length})`);
  assert(result.messages[0].role === 'system', '保护规则 → 第一条是 system');
  assert(result.messages[1].role === 'user', '保护规则 → 第二条是 user');
}

async function testTrimReportsCorrectly() {
  const counter = new TokenCounter();
  const messages: Message[] = [
    { role: 'system', content: '系统' },
    { role: 'user', content: '用户' },
    { role: 'tool', content: 'a'.repeat(100), tool_call_id: 'c1' },
  ];

  const result = counter.trimMessages(messages, { maxToolResultTokens: 10 });
  assert(result.originalTokens > result.trimmedTokens || result.truncatedCount > 0,
    '报告正确 → 有裁剪发生');
  assert(typeof result.originalTokens === 'number', '报告正确 → originalTokens 是数字');
  assert(typeof result.trimmedTokens === 'number', '报告正确 → trimmedTokens 是数字');
  assert(typeof result.removedCount === 'number', '报告正确 → removedCount 是数字');
  assert(typeof result.truncatedCount === 'number', '报告正确 → truncatedCount 是数字');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n📋 TokenCounter 单元测试\n`);

  await testCountTextChinese();
  await testCountTextEnglish();
  await testCountTextEmpty();
  await testCountMessage();
  await testCountMessageWithToolCalls();
  await testCountMessages();
  await testTrimEmptyMessages();
  await testTrimNoOpWhenUnderLimit();
  await testTrimToolMessageTruncation();
  await testTrimOverallRemoval();
  await testTrimProtectsSystemAndFirstUser();
  await testTrimReportsCorrectly();

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('测试运行失败:', error);
  process.exit(1);
});
