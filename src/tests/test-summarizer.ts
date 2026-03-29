/**
 * src/tests/test-summarizer.ts
 *
 * 测试目标：验证 Summarizer（LLM 摘要压缩器）
 * 阶段：Phase 4 (v3.1.0) — LLM 摘要压缩
 * 依赖：无（使用 MockLLMClient，不需要 API Key）
 *
 * 测试用例：
 * 1. 短对话不触发摘要
 * 2. 长对话触发摘要（超过阈值）
 * 3. 空消息列表 → 不触发
 * 4. 摘要后消息结构完整（system 摘要 + 剩余消息）
 * 5. 摘要后 token 数减少
 * 6. LLM 调用失败 → 返回原始消息
 * 7. 已有摘要锚点时正确处理
 */

import { TokenCounter } from '../utils/token-counter.js';
import { Summarizer } from '../session/summarizer.js';
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

/**
 * Mock LLM Client —— 不需要真实 API 调用
 *
 * chat() 方法返回一个固定的 assistant 回复，模拟摘要生成。
 */
class MockLLMClient {
  private responseContent: string;
  private shouldFail: boolean;

  constructor(options?: { responseContent?: string; shouldFail?: boolean }) {
    this.responseContent = options?.responseContent || '[摘要测试] 这是压缩后的摘要内容，保留了关键决策和用户偏好。';
    this.shouldFail = options?.shouldFail || false;
  }

  async chat(): Promise<Message> {
    if (this.shouldFail) {
      throw new Error('Mock LLM error');
    }
    return {
      role: 'assistant',
      content: this.responseContent,
    };
  }
}

/** 生成大量消息用于测试摘要触发 */
function generateLongMessages(count: number, tokenPerMsg: number = 200): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: 'user',
      content: `用户消息第 ${i} 条：${'数据填充'.repeat(tokenPerMsg / 4)}`,
    });
    messages.push({
      role: 'assistant',
      content: `助手回复第 ${i} 条：${'内容填充'.repeat(tokenPerMsg / 4)}`,
    });
  }
  return messages;
}

// ═══════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════

async function testShortConversationNoSummarize() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient() as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 80000 },
  );

  const messages: Message[] = [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，有什么可以帮助你的？' },
  ];

  const result = await summarizer.summarize(messages);
  assert(!result.summarized, '短对话 → 不触发摘要');
  assert(result.messages.length === 2, '短对话 → 消息数量不变');
  assert(result.compressedCount === 0, '短对话 → 压缩数为 0');
}

async function testLongConversationTriggersSummarize() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient() as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 1000, maxMessagesToSummarize: 20 },
  );

  // 生成足够多的消息以超过 1000 token 阈值
  const messages = generateLongMessages(30, 100);

  // 确认超过阈值
  const totalTokens = tokenCounter.countMessages(messages);
  assert(totalTokens > 1000, `长对话 → 总 token 数 ${totalTokens} 超过阈值 1000`);

  const result = await summarizer.summarize(messages);
  assert(result.summarized, '长对话 → 触发摘要');
  assert(result.compressedCount > 0, `长对话 → 压缩了 ${result.compressedCount} 条消息`);
  assert(result.newTokens < result.originalTokens, `长对话 → token 减少 (${result.originalTokens} → ${result.newTokens})`);
}

async function testEmptyMessages() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient() as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
  );

  const result = await summarizer.summarize([]);
  assert(!result.summarized, '空消息 → 不触发摘要');
  assert(result.messages.length === 0, '空消息 → 返回空数组');
  assert(!summarizer.shouldSummarize([]), '空消息 → shouldSummarize 返回 false');
}

async function testSummaryMessageStructure() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient() as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 500, maxMessagesToSummarize: 10 },
  );

  const messages = generateLongMessages(20, 80);
  const result = await summarizer.summarize(messages);

  // 摘要后应该有 system 摘要消息 + 剩余消息
  const hasSummaryMessage = result.messages.some(
    msg => msg.role === 'system' && msg.content.includes('[摘要]')
  );
  assert(hasSummaryMessage, '摘要后 → 包含 [摘要] 标记的 system 消息');

  // 摘要消息应该在最前面（或者紧跟已有的摘要）
  const summaryIdx = result.messages.findIndex(
    msg => msg.role === 'system' && msg.content.includes('[摘要]')
  );
  assert(summaryIdx >= 0, '摘要后 → 摘要消息存在');
}

async function testTokensReduce() {
  const tokenCounter = new TokenCounter();
  const mockResponse = '这是一段非常简短的摘要。';
  const summarizer = new Summarizer(
    new MockLLMClient({ responseContent: mockResponse }) as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 500, maxMessagesToSummarize: 30 },
  );

  const messages = generateLongMessages(40, 100);
  const result = await summarizer.summarize(messages);

  assert(result.summarized, 'Token 减少 → 触发了摘要');
  // 摘要后总 token 应该显著减少
  const ratio = result.newTokens / result.originalTokens;
  assert(ratio < 0.8, `Token 减少 → 比例 ${ratio.toFixed(2)} < 0.8`);
}

async function testLLMFailureGraceful() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient({ shouldFail: true }) as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 500, maxMessagesToSummarize: 10, verbose: true },
  );

  const messages = generateLongMessages(20, 80);
  const originalLength = messages.length;

  const result = await summarizer.summarize(messages);
  assert(!result.summarized, 'LLM 失败 → 不标记为已摘要');
  assert(result.messages.length === originalLength, 'LLM 失败 → 返回原始消息');
}

async function testExistingSummaryAnchor() {
  const tokenCounter = new TokenCounter();
  const summarizer = new Summarizer(
    new MockLLMClient() as unknown as import('../llm/client.js').LLMClient,
    tokenCounter,
    { summarizeThreshold: 500, maxMessagesToSummarize: 10 },
  );

  // 已有摘要锚点
  const messages: Message[] = [
    { role: 'system', content: '[摘要] 之前的对话摘要...' },
    ...generateLongMessages(20, 80),
  ];

  const result = await summarizer.summarize(messages);
  assert(result.summarized, '已有锚点 → 仍然触发新摘要');

  // 新摘要应该替换旧的（或追加在旧摘要之后）
  const summaryMessages = result.messages.filter(
    msg => msg.role === 'system' && msg.content.includes('[摘要]')
  );
  assert(summaryMessages.length >= 1, '已有锚点 → 至少有 1 条摘要消息');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n📋 Summarizer 单元测试\n`);

  await testShortConversationNoSummarize();
  await testLongConversationTriggersSummarize();
  await testEmptyMessages();
  await testSummaryMessageStructure();
  await testTokensReduce();
  await testLLMFailureGraceful();
  await testExistingSummaryAnchor();

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('测试运行失败:', error);
  process.exit(1);
});
