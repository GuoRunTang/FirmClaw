/**
 * src/tests/test-session-branch.ts
 *
 * Session Branch 单元测试。
 *
 * v4.5: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionManager } from '../session/manager.js';
import type { StoredMessage } from '../session/types.js';

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
// 临时目录
// ═══════════════════════════════════════════════════════════════

let tmpDir: string;
let testCounter = 0;
function freshDir(): string {
  testCounter++;
  return path.join(tmpDir, `test-${testCounter}`);
}
async function cleanupTmpDir(): Promise<void> {
  try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
}

function msg(role: 'user' | 'assistant', content: string): StoredMessage {
  return { role, content, timestamp: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  tmpDir = path.join(os.tmpdir(), `firmclaw-branch-test-${Date.now()}`);

  console.log('Session Branch Tests');
  console.log('====================');

  describe('SessionManager.branch()', () => {
    it('creates branch with correct messages', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first message');

      await sm.append([msg('user', 'msg1')]);
      await sm.append([msg('assistant', 'msg2')]);
      await sm.append([msg('assistant', 'msg3')]);
      await sm.append([msg('assistant', 'msg4')]);

      const branch = await sm.branch(3, 'test branch');

      assert(branch.id !== sm.getCurrentSessionId(), 'different id');
      assertEqual(branch.parentSessionId, sm.getCurrentSessionId(), 'parent set');
      assertEqual(branch.branchPoint, 3, 'branchPoint is 3');
      assertEqual(branch.messageCount, 3, '3 messages in branch');

      sm.switchSession(branch.id);
      const msgs = await sm.getMessages();
      assertEqual(msgs.length, 3, '3 messages');
    });

    it('branch at index 0 creates empty branch', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');

      await sm.append([msg('user', 'msg1')]);
      await sm.append([msg('assistant', 'msg2')]);

      const branch = await sm.branch(0);
      assertEqual(branch.messageCount, 0, '0 messages');
      assertEqual(branch.branchPoint, 0, 'branchPoint is 0');
    });

    it('branch at out-of-range index clips to max', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');

      await sm.append([msg('user', 'msg1')]);
      await sm.append([msg('assistant', 'msg2')]);

      const branch = await sm.branch(100);
      assertEqual(branch.messageCount, 2, 'clipped to 2');
      assertEqual(branch.branchPoint, 2, 'branchPoint is 2');
    });

    it('branch uses custom title', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');
      await sm.append([msg('user', 'msg1')]);

      const branch = await sm.branch(1, 'My custom branch');
      assertEqual(branch.title, 'My custom branch', 'custom title');
    });
  });

  describe('listBranches()', () => {
    it('lists branches of a session', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');

      await sm.append([msg('user', 'msg1')]);
      await sm.append([msg('assistant', 'msg2')]);
      await sm.append([msg('assistant', 'msg3')]);

      const parentId = sm.getCurrentSessionId()!;
      await sm.branch(1, 'branch-1');
      await sm.branch(2, 'branch-2');

      const branches = await sm.listBranches(parentId);
      assertEqual(branches.length, 2, '2 branches');
      assertEqual(branches[0].parentSessionId, parentId, 'parent matches');
    });

    it('returns empty for session with no branches', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');
      await sm.append([msg('user', 'msg1')]);

      const branches = await sm.listBranches();
      assertEqual(branches.length, 0, 'no branches');
    });
  });

  describe('Branch isolation', () => {
    it('adding to branch does not affect parent', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      await sm.create(dir, 'first');

      await sm.append([msg('user', 'msg1')]);
      await sm.append([msg('assistant', 'msg2')]);

      const parentId = sm.getCurrentSessionId()!;
      const branch = await sm.branch(2);

      sm.switchSession(branch.id);
      await sm.append([msg('user', 'branch message')]);

      sm.switchSession(parentId);
      const parentMsgs = await sm.getMessages();
      assertEqual(parentMsgs.length, 2, 'parent still has 2 messages');

      sm.switchSession(branch.id);
      const branchMsgs = await sm.getMessages();
      assertEqual(branchMsgs.length, 3, 'branch has 3 messages');
    });
  });

  describe('Edge cases', () => {
    it('branch without active session throws', async () => {
      const dir = freshDir();
      const sm = new SessionManager({ storageDir: dir });
      try {
        await sm.branch(0);
        assert(false, 'should have thrown');
      } catch (err: unknown) {
        assert(err instanceof Error, 'is Error');
        assert(err.message.includes('No active session'), 'correct message');
      }
    });
  });
}

// ──── 运行 ────

runTests()
  .then(async () => {
    await runTestQueue();
    await cleanupTmpDir();
    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await cleanupTmpDir();
    process.exit(1);
  });
