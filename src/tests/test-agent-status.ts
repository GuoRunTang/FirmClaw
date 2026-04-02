/**
 * src/tests/test-agent-status.ts
 *
 * v7.2: Agent 状态指示系统测试
 *
 * 测试覆盖：
 * - event-stream: AgentStatusType 类型、agent_status 事件发射
 * - types: EVENT_TO_NOTIFICATION_METHOD 映射
 * - agent-loop: 各关键节点的状态事件发射
 * - web-ui: HTML 包含状态指示器元素、agentBusy 逻辑
 */

import { EventStream, type AgentStatusType } from '../utils/event-stream.js';
import { EVENT_TO_NOTIFICATION_METHOD } from '../gateway/types.js';
import { getWebUIHTML } from '../gateway/web-ui.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架（内联，保持零依赖）
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

const testQueue: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function describe(name: string, fn: () => void): void {
  console.error(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => Promise<void> | void): void {
  testQueue.push({ name, fn });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTestQueue(): Promise<void> {
  for (const { name, fn } of testQueue) {
    try {
      await fn();
      passed++;
      console.error(`    PASS ${name}`);
    } catch (err: unknown) {
      failed++;
      console.error(`    FAIL ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

// ──── 1. EventStream: agent_status 事件 ────

describe('EventStream: agent_status 事件', () => {
  it('应该能发射 agent_status 事件', () => {
    const events = new EventStream();
    let received: unknown = null;
    events.on('agent_status', (e) => { received = e.data; });
    events.emit('agent_status', { status: 'thinking' });
    assertEqual((received as { status: string }).status, 'thinking');
  });

  it('应该能发射带 toolName 的 agent_status 事件', () => {
    const events = new EventStream();
    let received: unknown = null;
    events.on('agent_status', (e) => { received = e.data; });
    events.emit('agent_status', { status: 'tool_executing', toolName: 'read_file' });
    const data = received as { status: string; toolName: string };
    assertEqual(data.status, 'tool_executing');
    assertEqual(data.toolName, 'read_file');
  });

  it('应该能发射带 detail 的 agent_status 事件', () => {
    const events = new EventStream();
    let received: unknown = null;
    events.on('agent_status', (e) => { received = e.data; });
    events.emit('agent_status', { status: 'retrying', detail: 'context too long' });
    const data = received as { status: string; detail: string };
    assertEqual(data.status, 'retrying');
    assertEqual(data.detail, 'context too long');
  });

  it('应该能发射所有 11 种状态', () => {
    const statuses: AgentStatusType[] = [
      'idle', 'thinking', 'analyzing', 'tool_executing', 'tool_completed',
      'summarizing', 'trimming', 'retrying', 'approving', 'error', 'max_turns',
    ];
    const events = new EventStream();
    const received: AgentStatusType[] = [];
    events.on('agent_status', (e) => {
      received.push((e.data as { status: AgentStatusType }).status);
    });
    for (const s of statuses) {
      events.emit('agent_status', { status: s });
    }
    assertEqual(received.length, 11, '应收到 11 种状态');
    for (let i = 0; i < statuses.length; i++) {
      assertEqual(received[i], statuses[i], `状态 ${i}`);
    }
  });

  it('agent_status 事件应不影响其他事件', () => {
    const events = new EventStream();
    let statusReceived = false;
    let thinkingReceived = false;
    events.on('agent_status', () => { statusReceived = true; });
    events.on('thinking_delta', () => { thinkingReceived = true; });
    events.emit('agent_status', { status: 'thinking' });
    events.emit('thinking_delta', 'hello');
    assert(statusReceived, 'agent_status 应被接收');
    assert(thinkingReceived, 'thinking_delta 应被接收');
  });
});

// ──── 2. EVENT_TO_NOTIFICATION_METHOD 映射 ────

describe('EVENT_TO_NOTIFICATION_METHOD 映射', () => {
  it('应包含 agent_status 映射', () => {
    assert(
      'agent_status' in EVENT_TO_NOTIFICATION_METHOD,
      'EVENT_TO_NOTIFICATION_METHOD 应包含 agent_status 键',
    );
  });

  it('agent_status 应映射到 agent.status', () => {
    assertEqual(
      EVENT_TO_NOTIFICATION_METHOD.agent_status,
      'agent.status',
    );
  });

  it('映射不应破坏已有的映射', () => {
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.thinking_delta, 'agent.thinking');
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.tool_start, 'agent.tool_start');
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.tool_end, 'agent.tool_end');
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.message_end, 'agent.message_end');
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.error, 'agent.error');
    assertEqual(EVENT_TO_NOTIFICATION_METHOD.session_start, 'session.started');
  });

  it('映射键应包含 agent_status', () => {
    const keys = Object.keys(EVENT_TO_NOTIFICATION_METHOD);
    assert(keys.includes('agent_status'), `映射应包含 agent_status 键，实际键: ${keys.join(', ')}`);
  });
});

// ──── 3. Web UI HTML 结构 ────

describe('Web UI: 状态指示器 HTML', () => {
  const html = getWebUIHTML();

  it('应包含 agentStatus 元素', () => {
    assert(
      html.includes('id="agentStatus"'),
      'HTML 应包含 agentStatus 元素',
    );
  });

  it('应包含状态图标元素', () => {
    assert(
      html.includes('id="agentStatusIcon"'),
      'HTML 应包含 agentStatusIcon 元素',
    );
  });

  it('应包含状态文本元素', () => {
    assert(
      html.includes('id="agentStatusLabel"'),
      'HTML 应包含 agentStatusLabel 元素',
    );
  });

  it('应包含状态详情元素', () => {
    assert(
      html.includes('id="agentStatusDetail"'),
      'HTML 应包含 agentStatusDetail 元素',
    );
  });

  it('应包含 agent.status 通知处理', () => {
    assert(
      html.includes("case 'agent.status'"),
      'JS 应包含 agent.status 通知处理',
    );
  });

  it('应包含 updateAgentStatus 函数', () => {
    assert(
      html.includes('function updateAgentStatus'),
      'JS 应包含 updateAgentStatus 函数',
    );
  });

  it('应包含 setAgentBusy 函数', () => {
    assert(
      html.includes('function setAgentBusy'),
      'JS 应包含 setAgentBusy 函数',
    );
  });

  it('应包含 agentBusy 变量', () => {
    assert(
      html.includes('var agentBusy'),
      'JS 应包含 agentBusy 变量',
    );
  });

  it('sendMessage 应检查 agentBusy', () => {
    assert(
      html.includes('agentBusy)'),
      'sendMessage 应检查 agentBusy',
    );
  });

  it('应包含状态指示器 CSS', () => {
    assert(
      html.includes('.agent-status'),
      'CSS 应包含 .agent-status 样式',
    );
  });

  it('应包含发送按钮 busy 样式', () => {
    assert(
      html.includes('button.busy'),
      'CSS 应包含 button.busy 样式',
    );
  });

  it('应包含所有状态的 CSS 动画', () => {
    assert(
      html.includes('[data-status="thinking"]'),
      'CSS 应包含 thinking 状态样式',
    );
    assert(
      html.includes('[data-status="tool_executing"]'),
      'CSS 应包含 tool_executing 状态样式',
    );
    assert(
      html.includes('[data-status="approving"]'),
      'CSS 应包含 approving 状态样式',
    );
    assert(
      html.includes('[data-status="error"]'),
      'CSS 应包含 error 状态样式',
    );
  });

  it('中文 I18N 应包含所有状态文本', () => {
    assert(html.includes("statusThinking: '正在思考'"), '应有 statusThinking');
    assert(html.includes("statusAnalyzing: '正在分析'"), '应有 statusAnalyzing');
    assert(html.includes("statusToolExecuting: '正在执行'"), '应有 statusToolExecuting');
    assert(html.includes("statusToolCompleted: '已完成'"), '应有 statusToolCompleted');
    assert(html.includes("statusSummarizing: '正在压缩上下文'"), '应有 statusSummarizing');
    assert(html.includes("statusTrimming: '正在裁剪上下文'"), '应有 statusTrimming');
    assert(html.includes("statusRetrying: '正在重试'"), '应有 statusRetrying');
    assert(html.includes("statusApproving: '等待审批'"), '应有 statusApproving');
    assert(html.includes("statusError: '执行出错'"), '应有 statusError');
    assert(html.includes("statusMaxTurns: '达到最大轮次'"), '应有 statusMaxTurns');
    assert(html.includes("sendBusy: '处理中'"), '应有 sendBusy');
    assert(html.includes("waitHint: 'Agent 正在处理，请等待...'"), '应有 waitHint');
  });

  it('英文 I18N 应包含所有状态文本', () => {
    assert(html.includes("statusThinking: 'Thinking'"), '应有 en statusThinking');
    assert(html.includes("statusToolExecuting: 'Executing'"), '应有 en statusToolExecuting');
    assert(html.includes("sendBusy: 'Working'"), '应有 en sendBusy');
    assert(html.includes("waitHint: 'Agent is processing"), '应有 en waitHint');
  });

  it('agent.chat 响应应重置忙碌状态', () => {
    assert(
      html.includes("setAgentBusy(false)") && html.includes('agentStatus'),
      'agent.chat 响应处理应调用 setAgentBusy(false)',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 运行
// ═══════════════════════════════════════════════════════════════

console.error('\n╔══════════════════════════════════════╗');
console.error('║  test-agent-status (v7.2)            ║');
console.error('╚══════════════════════════════════════╝');

runTestQueue().then(() => {
  console.error(`\n  Results: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  if (failed > 0) {
    process.exit(1);
  }
});
