/**
 * src/tests/test-heartbeat.ts
 *
 * Heartbeat 单元测试。
 *
 * v4.4: 初始实现
 */

import { Heartbeat } from '../agent/heartbeat.js';
import type { HeartbeatStats } from '../agent/heartbeat.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架（内联，保持零依赖）
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const testQueue: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function describe(name: string, fn: () => void): void {
  console.log(`\n  ${name}`);
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

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTestQueue(): Promise<void> {
  for (const { name, fn } of testQueue) {
    try {
      await fn();
      passed++;
      console.log(`    \u2713 ${name}`);
    } catch (err: unknown) {
      failed++;
      console.error(`    \u2717 ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('Heartbeat Tests');
  console.log('================');

  // ──── 生命周期 ────

  describe('Lifecycle', () => {
    it('starts in idle state', () => {
      const hb = new Heartbeat({ taskPrompt: 'test' }, async () => {});
      assertEqual(hb.getStatus(), 'idle', 'initial state');
    });

    it('transitions idle -> running on start', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.start();
      assertEqual(hb.getStatus(), 'running', 'after start');
      hb.stop();
    });

    it('transitions running -> stopped on stop', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.start();
      hb.stop();
      assertEqual(hb.getStatus(), 'stopped', 'after stop');
    });

    it('transitions running -> paused on pause', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.start();
      hb.pause();
      assertEqual(hb.getStatus(), 'paused', 'after pause');
      hb.stop();
    });

    it('transitions paused -> running on resume', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.start();
      hb.pause();
      hb.resume();
      assertEqual(hb.getStatus(), 'running', 'after resume');
      hb.stop();
    });

    it('start on stopped does nothing', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.start();
      hb.stop();
      hb.start(); // should be no-op
      assertEqual(hb.getStatus(), 'stopped', 'still stopped');
    });

    it('pause on non-running does nothing', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      hb.pause(); // should be no-op
      assertEqual(hb.getStatus(), 'idle', 'still idle');
    });
  });

  // ──── Tick 执行 ────

  describe('Tick execution', () => {
    it('calls onTick callback', async () => {
      let called = false;
      const hb = new Heartbeat(
        { taskPrompt: 'do something', intervalMs: 100 },
        async (prompt) => {
          called = true;
          assertEqual(prompt, 'do something', 'prompt passed');
        },
      );
      hb.start();
      await sleep(200);
      hb.stop();
      assert(called, 'onTick was called');
    });

    it('ticks multiple times', async () => {
      let callCount = 0;
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50 },
        async () => { callCount++; },
      );
      hb.start();
      await sleep(250);
      hb.stop();
      assert(callCount >= 3, `expected >= 3 calls, got ${callCount}`);
    });

    it('stops at maxTicks', async () => {
      let callCount = 0;
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50, maxTicks: 2 },
        async () => { callCount++; },
      );
      hb.start();
      await sleep(300);
      assertEqual(hb.getStatus(), 'stopped', 'auto-stopped');
      assertEqual(callCount, 2, 'exactly 2 ticks');
    });

    it('handles errors without crashing', async () => {
      let callCount = 0;
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50 },
        async () => {
          callCount++;
          if (callCount === 1) throw new Error('intentional error');
        },
      );
      hb.start();
      await sleep(200);
      hb.stop();

      const stats = hb.getStats();
      assertEqual(stats.errorCount, 1, '1 error recorded');
      assert(callCount >= 2, `heartbeat continued after error, total calls: ${callCount}`);
    });
  });

  // ──── Stats ────

  describe('Stats', () => {
    it('getStats returns correct initial values', () => {
      const hb = new Heartbeat({ taskPrompt: 'test', intervalMs: 10000 }, async () => {});
      const stats = hb.getStats();
      assertEqual(stats.status, 'idle', 'status');
      assertEqual(stats.ticksCompleted, 0, 'ticksCompleted');
      assertEqual(stats.errorCount, 0, 'errorCount');
      assertEqual(stats.lastTickAt, null, 'lastTickAt');
    });

    it('ticksCompleted increments', async () => {
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50, maxTicks: 3 },
        async () => {},
      );
      hb.start();
      await sleep(250);
      const stats = hb.getStats();
      assertEqual(stats.ticksCompleted, 3, '3 completed');
      assert(stats.lastTickAt, 'lastTickAt set');
    });

    it('ticksRemaining decreases', async () => {
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50, maxTicks: 5 },
        async () => {},
      );
      hb.start();
      await sleep(80);
      const stats = hb.getStats();
      assert(stats.ticksRemaining < 5, 'remaining decreased');
    });
  });

  // ──── Prompt 更新 ────

  describe('Prompt update', () => {
    it('updatePrompt changes the task', () => {
      const hb = new Heartbeat({ taskPrompt: 'original' }, async () => {});
      assertEqual(hb.getTaskPrompt(), 'original', 'initial prompt');
      hb.updatePrompt('updated');
      assertEqual(hb.getTaskPrompt(), 'updated', 'updated prompt');
    });

    it('new prompt used in next tick', async () => {
      let lastPrompt = '';
      const hb = new Heartbeat(
        { taskPrompt: 'initial', intervalMs: 50 },
        async (prompt) => { lastPrompt = prompt; },
      );
      hb.start();
      await sleep(80);
      hb.updatePrompt('second');
      await sleep(80);
      hb.stop();
      assertEqual(lastPrompt, 'second', 'updated prompt used');
    });
  });

  // ──── 边界情况 ────

  describe('Edge cases', () => {
    it('maxTicks=0 means no limit (but we only wait 3 ticks)', async () => {
      let callCount = 0;
      const hb = new Heartbeat(
        { taskPrompt: 'test', intervalMs: 50, maxTicks: 0 },
        async () => {
          callCount++;
          if (callCount >= 3) hb.stop(); // manually stop after 3
        },
      );
      hb.start();
      await sleep(300);
      assertEqual(callCount, 3, '3 ticks before manual stop');
    });

    it('stop() can be called multiple times safely', () => {
      const hb = new Heartbeat({ taskPrompt: 'test' }, async () => {});
      hb.stop();
      hb.stop();
      assertEqual(hb.getStatus(), 'stopped', 'still stopped');
    });

    it('default config values', () => {
      const hb = new Heartbeat({ taskPrompt: 'test' }, async () => {});
      const stats = hb.getStats();
      assertEqual(stats.status, 'idle', 'idle');
      // Default interval should allow tick to happen within reasonable time
      assert(hb.getTaskPrompt() === 'test', 'default prompt');
    });
  });
}

// ──── 运行 ────

runTests().then(async () => {
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
