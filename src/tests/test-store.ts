/**
 * src/tests/test-store.ts
 *
 * IssueStore 单元测试。
 *
 * v1.0: 初始实现
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { IssueStore } from '../issues/store.js';

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
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('IssueStore Tests');
  console.log('================');

  // 使用临时目录
  const tmpDir = path.join(os.tmpdir(), `firmclaw-test-store-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    describe('constructor', () => {
      it('creates storage directory', () => {
        const store = new IssueStore(tmpDir);
        assert(fs.existsSync(tmpDir), 'dir should exist');
      });
      it('works without explicit storageDir', () => {
        const store = new IssueStore();
        assert(fs.existsSync(store.getStorageDir()), 'default dir should exist');
        // cleanup
        fs.rmSync(store.getStorageDir(), { recursive: true, force: true });
      });
    });

    describe('record', () => {
      it('returns IssueRecord with id and timestamp', () => {
        const store = new IssueStore(tmpDir);
        const r = store.record({
          category: 'API',
          subCategory: 'api_call_failed',
          severity: 'error',
          sessionId: 'sess-001',
          sessionTitle: 'Test Session',
          toolName: 'bash',
          description: 'LLM API call failed',
        });
        assert(r.id.startsWith('iss_'), 'id should start with iss_');
        assert(r.timestamp.length > 0, 'should have timestamp');
        assertEqual(r.category, 'API');
        assertEqual(r.sessionId, 'sess-001');
        assertEqual(r.toolName, 'bash');
        assertEqual(r.resolved, false);
      });
      it('increments sequence for each record', () => {
        const store = new IssueStore(tmpDir);
        const r1 = store.record({ category: 'ENV', subCategory: 'env_enoent', severity: 'error', sessionId: 's1', description: 'a' });
        const r2 = store.record({ category: 'ENV', subCategory: 'env_enoent', severity: 'error', sessionId: 's1', description: 'b' });
        const seq1 = parseInt(r1.id.split('_').pop()!);
        const seq2 = parseInt(r2.id.split('_').pop()!);
        assert(seq2 > seq1, 'sequence should increment');
      });
    });

    describe('getBySession / getAll', () => {
      it('returns empty array for unknown session', () => {
        const store = new IssueStore(tmpDir);
        assertEqual(store.getBySession('nonexistent'), []);
      });
      it('returns records for known session', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'env_enoent', severity: 'error', sessionId: 's1', description: 'a' });
        store.record({ category: 'ENV', subCategory: 'env_enoent', severity: 'error', sessionId: 's1', description: 'b' });
        store.record({ category: 'API', subCategory: 'api_call_failed', severity: 'error', sessionId: 's2', description: 'c' });
        assertEqual(store.getBySession('s1').length, 2);
        assertEqual(store.getBySession('s2').length, 1);
      });
      it('getAll returns all records', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        store.record({ category: 'API', subCategory: 'y', severity: 'warning', sessionId: 'b', description: '' });
        assertEqual(store.getAll().length, 2);
      });
    });

    describe('counting', () => {
      it('totalCount tracks all records', () => {
        const store = new IssueStore(tmpDir);
        assertEqual(store.totalCount, 0);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        store.record({ category: 'API', subCategory: 'y', severity: 'warning', sessionId: 'b', description: '' });
        assertEqual(store.totalCount, 3);
      });
      it('countBySession works', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        assertEqual(store.countBySession('a'), 2);
        assertEqual(store.countBySession('b'), 0);
      });
    });

    describe('markResolved', () => {
      it('marks a record as resolved', () => {
        const store = new IssueStore(tmpDir);
        const r = store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 's1', description: '' });
        assertEqual(r.resolved, false);
        const result = store.markResolved(r.id);
        assertEqual(result, true);
        assertEqual(store.getBySession('s1')[0].resolved, true);
      });
      it('returns false for unknown id', () => {
        const store = new IssueStore(tmpDir);
        assertEqual(store.markResolved('iss_nonexistent_1'), false);
      });
    });

    describe('JSONL persistence', () => {
      it('writes JSONL file on record', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'TOOL', subCategory: 'tool_crash', severity: 'error', sessionId: 'persist-1', description: 'crash' });
        const filePath = store.getSessionJsonlPath('persist-1');
        assert(fs.existsSync(filePath), 'jsonl file should exist');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        assertEqual(lines.length, 1);
        const parsed = JSON.parse(lines[0]);
        assertEqual(parsed.category, 'TOOL');
        assertEqual(parsed.description, 'crash');
      });
      it('appends to existing JSONL file', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'append-1', description: 'first' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'append-1', description: 'second' });
        const content = fs.readFileSync(store.getSessionJsonlPath('append-1'), 'utf-8');
        const lines = content.trim().split('\n');
        assertEqual(lines.length, 2);
      });
    });

    describe('loadSession / loadAll', () => {
      it('loads records from JSONL file', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'API', subCategory: 'api_timeout', severity: 'error', sessionId: 'load-1', description: 'timeout' });
        store.record({ category: 'API', subCategory: 'api_timeout', severity: 'error', sessionId: 'load-1', description: 'timeout2' });

        // 新建 store 实例加载
        const store2 = new IssueStore(tmpDir);
        const records = store2.loadSession('load-1');
        assertEqual(records.length, 2);
        assertEqual(records[0].description, 'timeout');
      });
      it('loadAll loads all sessions', () => {
        const subDir = path.join(tmpDir, 'loadall-test');
        fs.mkdirSync(subDir, { recursive: true });
        const store = new IssueStore(subDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'all-a', description: '' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'all-b', description: '' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'all-b', description: '' });

        const store2 = new IssueStore(subDir);
        store2.loadAll();
        assertEqual(store2.totalCount, 3);
        assertEqual(store2.getSessionIds().length, 2);
      });
      it('handles non-existent session gracefully', () => {
        const store = new IssueStore(tmpDir);
        const records = store.loadSession('nonexistent');
        assertEqual(records.length, 0);
      });
      it('handles corrupt JSONL lines gracefully', () => {
        const filePath = path.join(tmpDir, 'corrupt.jsonl');
        fs.writeFileSync(filePath, '{"id":"iss_1"}\ninvalid json\n{"id":"iss_2"}\n', 'utf-8');
        const store = new IssueStore(tmpDir);
        const records = store.loadSession('corrupt');
        assertEqual(records.length, 2, 'should skip corrupt line');
      });
    });

    describe('clear', () => {
      it('clearSession removes session from memory', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'clr', description: '' });
        assertEqual(store.countBySession('clr'), 1);
        store.clearSession('clr');
        assertEqual(store.countBySession('clr'), 0);
      });
      it('clear removes everything from memory', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'a', description: '' });
        store.record({ category: 'API', subCategory: 'y', severity: 'warning', sessionId: 'b', description: '' });
        store.clear();
        assertEqual(store.totalCount, 0);
        assertEqual(store.getSessionIds().length, 0);
      });
    });

    describe('getSessionIds', () => {
      it('returns unique session IDs', () => {
        const store = new IssueStore(tmpDir);
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'id-a', description: '' });
        store.record({ category: 'ENV', subCategory: 'x', severity: 'error', sessionId: 'id-a', description: '' });
        store.record({ category: 'API', subCategory: 'y', severity: 'warning', sessionId: 'id-b', description: '' });
        const ids = store.getSessionIds().sort();
        assertEqual(ids, ['id-a', 'id-b']);
      });
    });

  } finally {
    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ──── 运行 ────

runTests().then(async () => {
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
