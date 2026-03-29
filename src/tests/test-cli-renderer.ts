/**
 * src/tests/test-cli-renderer.ts
 *
 * Renderer + ProgressIndicator 单元测试。
 *
 * 测试覆盖：
 * - Renderer: Markdown 渲染（标题、粗体、代码、列表、引用块、代码块）
 * - Renderer: 工具信息渲染、错误渲染、系统消息
 * - Renderer: 颜色开关
 * - ProgressIndicator: 工具计时、循环进度、Heartbeat 状态、搜索状态
 *
 * v5.2: 初始实现
 */

import { Renderer } from '../cli/renderer.js';
import { ProgressIndicator } from '../cli/progress.js';

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

function assertIncludes(text: string, substr: string, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  if (!text.includes(substr)) {
    throw new Error(`${prefix}Expected "${text}" to include "${substr}"`);
  }
}

function assertNotIncludes(text: string, substr: string, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  if (text.includes(substr)) {
    throw new Error(`${prefix}Expected "${text}" to NOT include "${substr}"`);
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

async function runTests(): Promise<void> {
  console.error('CLI Renderer + ProgressIndicator Tests (v5.2)');
  console.error('===============================================');

  // ──── Renderer 测试 ────

  describe('Renderer - Markdown', () => {
    it('渲染一级标题', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderMarkdown('# Hello World');
      assertIncludes(result, 'Hello World');
    });

    it('渲染二级标题', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderMarkdown('## Sub heading');
      assertIncludes(result, 'Sub heading');
    });

    it('渲染粗体文本', () => {
      const r = new Renderer({ color: false });
      const result = r.renderMarkdown('This is **bold** text');
      assertIncludes(result, 'bold');
      assertNotIncludes(result, '**');
    });

    it('渲染行内代码', () => {
      const r = new Renderer({ color: false });
      const result = r.renderMarkdown('Use `console.log()` to debug');
      assertIncludes(result, 'console.log()');
      assertNotIncludes(result, '`');
    });

    it('渲染列表项', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderMarkdown('- Item 1\n- Item 2');
      assertIncludes(result, 'Item 1');
      assertIncludes(result, 'Item 2');
    });

    it('渲染引用块', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderMarkdown('> This is a quote');
      assertIncludes(result, 'This is a quote');
    });

    it('渲染代码块', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderMarkdown('```typescript\nconst x = 1;\n```');
      assertIncludes(result, 'const x = 1;');
      assertIncludes(result, 'typescript');
    });

    it('渲染多行 Markdown', () => {
      const r = new Renderer({ color: false });
      const result = r.renderMarkdown('# Title\n\nSome **bold** text.\n\n- item1\n- item2');
      assertIncludes(result, 'Title');
      assertIncludes(result, 'bold');
      assertIncludes(result, 'item1');
      assertIncludes(result, 'item2');
    });

    it('纯文本原样输出', () => {
      const r = new Renderer({ color: false });
      const result = r.renderMarkdown('Just plain text.');
      assertIncludes(result, 'Just plain text.');
    });
  });

  describe('Renderer - 颜色', () => {
    it('启用颜色时包含 ANSI 转义序列', () => {
      const r = new Renderer({ color: true });
      const result = r.renderMarkdown('**bold**');
      assertIncludes(result, '\x1b[', 'should contain ANSI');
    });

    it('禁用颜色时不包含 ANSI 转义序列', () => {
      const r = new Renderer({ color: false });
      const result = r.renderMarkdown('**bold**');
      assertNotIncludes(result, '\x1b[', 'should not contain ANSI');
    });

    it('renderInline 渲染粗体', () => {
      const r = new Renderer({ color: false });
      const result = r.renderInline('hello **world** test');
      assertIncludes(result, 'world');
      assertNotIncludes(result, '**');
    });

    it('renderInline 渲染行内代码', () => {
      const r = new Renderer({ color: false });
      const result = r.renderInline('use `test` here');
      assertIncludes(result, "'test'");
    });
  });

  describe('Renderer - 工具信息', () => {
    it('renderToolStart 包含工具名和参数', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderToolStart('bash', { command: 'ls' });
      assertIncludes(result, 'bash');
      assertIncludes(result, 'ls');
    });

    it('renderToolEnd 包含工具名', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderToolEnd('bash', 'src/ docs/', false);
      assertIncludes(result, 'bash');
      assertIncludes(result, 'src/');
    });

    it('renderToolEnd 错误时使用不同的标记', () => {
      const r = new Renderer({ color: false, unicode: false });
      const successResult = r.renderToolEnd('bash', 'ok', false);
      const errorResult = r.renderToolEnd('bash', 'fail', true);
      // 成功和错误的渲染结果应该不同
      assert(successResult !== errorResult, 'success and error renderings should differ');
      assertIncludes(successResult, 'OK', 'success should have OK');
      assertIncludes(errorResult, 'X', 'error should have X');
    });

    it('renderToolEnd 长结果截断', () => {
      const r = new Renderer({ color: false, width: 30 });
      const longResult = 'a'.repeat(200);
      const result = r.renderToolEnd('bash', longResult);
      assert(result.length < 200, 'should be truncated');
    });

    it('renderError 包含错误信息', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderError('Something went wrong');
      assertIncludes(result, 'Error');
      assertIncludes(result, 'Something went wrong');
    });

    it('renderSystem 包含系统消息', () => {
      const r = new Renderer({ color: false });
      const result = r.renderSystem('Session started');
      assertIncludes(result, 'System');
      assertIncludes(result, 'Session started');
    });

    it('renderSeparator 返回分割线', () => {
      const r = new Renderer({ color: false, unicode: true });
      const result = r.renderSeparator();
      assert(result.length > 0, 'should not be empty');
    });

    it('renderApprovalPrompt 包含工具信息', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderApprovalPrompt('bash', { command: 'rm -rf /' }, 'high');
      assertIncludes(result, 'bash');
      assertIncludes(result, 'rm -rf /');
      assertIncludes(result, 'HIGH');
    });

    it('renderAuditEntry 包含审计信息', () => {
      const r = new Renderer({ color: false, unicode: false });
      const result = r.renderAuditEntry({
        id: 'aud_001',
        timestamp: '2026-03-29T12:00:00.000Z',
        eventType: 'tool_execution',
        toolName: 'bash',
        riskLevel: 'low',
        result: 'success',
      });
      assertIncludes(result, 'aud_001');
      assertIncludes(result, 'bash');
      assertIncludes(result, 'success');
    });
  });

  // ──── ProgressIndicator 测试 ────

  describe('ProgressIndicator', () => {
    it('startTool + endTool 返回耗时', () => {
      const p = new ProgressIndicator();
      p.startTool('bash');
      // 等待一小段时间
      const start = Date.now();
      while (Date.now() - start < 10) { /* busy wait */ }
      const duration = p.endTool();
      assert(duration.length > 0, 'should return duration string');
    });

    it('endTool 无 startTool 时返回空字符串', () => {
      const p = new ProgressIndicator();
      const duration = p.endTool();
      assertEqual(duration, '');
    });

    it('showTurnProgress 包含进度信息', () => {
      const p = new ProgressIndicator();
      const result = p.showTurnProgress(3, 10);
      assertIncludes(result, '3/10');
    });

    it('showTurnProgress 在 maxTurns=0 时不崩溃', () => {
      const p = new ProgressIndicator();
      const result = p.showTurnProgress(0, 0);
      assert(result.length > 0, 'should return something');
    });

    it('showHeartbeatStatus 包含统计信息', () => {
      const p = new ProgressIndicator();
      const result = p.showHeartbeatStatus({
        status: 'running',
        ticksCompleted: 5,
        ticksRemaining: 5,
        totalDurationMs: 300_000,
        lastTickAt: '2026-03-29T12:00:00.000Z',
        nextTickAt: null,
        errorCount: 1,
      });
      assertIncludes(result, 'running');
      assertIncludes(result, '5/10');
      assertIncludes(result, 'errors: 1');
    });

    it('showSearchStatus 包含搜索结果', () => {
      const p = new ProgressIndicator();
      const result = p.showSearchStatus('test query', 5);
      assertIncludes(result, 'test query');
      assertIncludes(result, '5');
      assertIncludes(result, 'found');
    });

    it('showSearchStatus 无结果时显示 no results', () => {
      const p = new ProgressIndicator();
      const result = p.showSearchStatus('nothing', 0);
      assertIncludes(result, 'no results');
    });

    it('showContextUsage 包含 token 数量', () => {
      const p = new ProgressIndicator();
      const result = p.showContextUsage(50000, 128000);
      assertIncludes(result, '50,000');
      assertIncludes(result, '128,000');
      assertIncludes(result, 'tokens');
    });
  });

  // ──── 运行所有测试 ────
  await runTestQueue();
}

// ═══════════════════════════════════════════════════════════════
// 运行
// ═══════════════════════════════════════════════════════════════

runTests().then(() => {
  console.error(`\n${'='.repeat(50)}`);
  console.error(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}).catch((err: unknown) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
