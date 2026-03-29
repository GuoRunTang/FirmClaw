/**
 * src/tests/test-hook-manager.ts
 *
 * HookManager 单元测试。
 *
 * v4.5: 初始实现
 */

import { HookManager } from '../tools/hook-manager.js';
import type { HookContext, BeforeHook, AfterHook } from '../tools/hook-manager.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const testQueue: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function describe(name: string, fn: () => void): void { console.log(`\n  ${name}`); fn(); }
function it(name: string, fn: () => Promise<void> | void): void { testQueue.push({ name, fn }); }
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
    try { await fn(); passed++; console.log(`    \u2713 ${name}`); }
    catch (err: unknown) { failed++; console.error(`    \u2717 ${name}`); console.error(`      ${err instanceof Error ? err.message : String(err)}`); }
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock ToolContext
// ═══════════════════════════════════════════════════════════════

function mockContext(): any {
  return { workDir: '/tmp', sessionId: null };
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('HookManager Tests');
  console.log('=================');

  // ──── Before Hooks ────

  describe('Before Hooks', () => {
    it('passthrough when no hooks registered', async () => {
      const hm = new HookManager();
      const ctx: HookContext = { toolName: 'bash', args: { command: 'ls' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, { command: 'ls' }, 'args unchanged');
    });

    it('passthrough hook returns original args', async () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => {});
      const ctx: HookContext = { toolName: 'bash', args: { command: 'ls' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, { command: 'ls' }, 'args unchanged');
    });

    it('modify args via before hook', async () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => ({ args: { command: 'ls -la' } }));
      const ctx: HookContext = { toolName: 'bash', args: { command: 'ls' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, { command: 'ls -la' }, 'args modified');
    });

    it('deny via before hook returns null', async () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => ({ deny: true, reason: 'Not allowed' }));
      const ctx: HookContext = { toolName: 'bash', args: { command: 'rm -rf /' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, null, 'denied');
    });

    it('first deny wins in multiple hooks', async () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => ({ deny: true, reason: 'first' }));
      hm.registerBefore('bash', () => ({ args: { command: 'safe' } }));
      const ctx: HookContext = { toolName: 'bash', args: { command: 'rm -rf /' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, null, 'first deny wins');
    });

    it('hook exception does not crash', async () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => { throw new Error('hook error'); });
      const ctx: HookContext = { toolName: 'bash', args: { command: 'ls' }, toolContext: mockContext() };
      const result = await hm.runBeforeHooks('bash', ctx);
      assertEqual(result, { command: 'ls' }, 'exception swallowed');
    });
  });

  // ──── After Hooks ────

  describe('After Hooks', () => {
    it('runs after hook with result', async () => {
      const hm = new HookManager();
      let captured: HookContext | null = null;
      hm.registerAfter('bash', (ctx) => { captured = ctx; });

      const ctx: HookContext = {
        toolName: 'bash',
        args: { command: 'ls' },
        result: { content: 'file1.txt\nfile2.txt', isError: false },
        toolContext: mockContext(),
      };
      await hm.runAfterHooks('bash', ctx);

      assert(captured !== null, 'hook called');
      assertEqual(captured!.toolName, 'bash', 'tool name');
      assertEqual(captured!.result!.content, 'file1.txt\nfile2.txt', 'result content');
    });

    it('async after hook works', async () => {
      const hm = new HookManager();
      let called = false;
      hm.registerAfter('bash', async () => { called = true; });

      const ctx: HookContext = {
        toolName: 'bash',
        args: {},
        result: { content: 'ok' },
        toolContext: mockContext(),
      };
      await hm.runAfterHooks('bash', ctx);
      assert(called, 'async hook called');
    });

    it('hook exception does not crash', async () => {
      const hm = new HookManager();
      hm.registerAfter('bash', () => { throw new Error('after error'); });
      hm.registerAfter('bash', () => {}); // second hook should still run

      const ctx: HookContext = {
        toolName: 'bash',
        args: {},
        result: { content: 'ok' },
        toolContext: mockContext(),
      };
      // Should not throw
      await hm.runAfterHooks('bash', ctx);
    });
  });

  // ──── Wildcard Hooks ────

  describe('Wildcard Hooks', () => {
    it('wildcard before hook matches all tools', async () => {
      const hm = new HookManager();
      let lastTool = '';
      hm.registerBefore('*', (ctx) => { lastTool = ctx.toolName; });

      await hm.runBeforeHooks('bash', { toolName: 'bash', args: {}, toolContext: mockContext() });
      assertEqual(lastTool, 'bash', 'matched bash');

      await hm.runBeforeHooks('read_file', { toolName: 'read_file', args: {}, toolContext: mockContext() });
      assertEqual(lastTool, 'read_file', 'matched read_file');
    });

    it('wildcard + specific hook both run', async () => {
      const hm = new HookManager();
      const order: string[] = [];
      hm.registerBefore('*', () => { order.push('wildcard'); });
      hm.registerBefore('bash', () => { order.push('specific'); });

      await hm.runBeforeHooks('bash', { toolName: 'bash', args: {}, toolContext: mockContext() });
      assertEqual(order, ['wildcard', 'specific'], 'wildcard runs first');
    });

    it('wildcard after hook matches all tools', async () => {
      const hm = new HookManager();
      let count = 0;
      hm.registerAfter('*', async () => { count++; });

      await hm.runAfterHooks('bash', { toolName: 'bash', args: {}, toolContext: mockContext() });
      await hm.runAfterHooks('read_file', { toolName: 'read_file', args: {}, toolContext: mockContext() });
      await hm.runAfterHooks('write_file', { toolName: 'write_file', args: {}, toolContext: mockContext() });

      assertEqual(count, 3, 'called 3 times');
    });
  });

  // ──── listHooks ────

  describe('listHooks', () => {
    it('returns empty list when no hooks', () => {
      const hm = new HookManager();
      assertEqual(hm.listHooks().length, 0, 'no hooks');
    });

    it('lists registered hooks', () => {
      const hm = new HookManager();
      hm.registerBefore('bash', () => {});
      hm.registerBefore('bash', () => {});
      hm.registerAfter('*', () => {});
      hm.registerAfter('read_file', () => {});

      const hooks = hm.listHooks();
      assertEqual(hooks.length, 3, '3 unique registrations');

      const bashBefore = hooks.find(h => h.toolName === 'bash' && h.type === 'before');
      assertEqual(bashBefore?.count, 2, 'bash before count');
    });
  });
}

// ──── 运行 ────

runTests().then(async () => {
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
