/**
 * src/tests/test-audit-logger.ts
 *
 * AuditLogger + AuditQuery 单元测试。
 *
 * 使用临时目录进行文件 I/O，测试结束后自动清理。
 * 每个测试使用独立的子目录，避免交叉污染。
 *
 * v4.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AuditLogger } from '../audit/logger.js';
import { AuditQuery } from '../audit/query.js';
import type { AuditEntry } from '../audit/types.js';

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
// 临时目录管理
// ═══════════════════════════════════════════════════════════════

let baseTmpDir: string;
let testCounter = 0;

/** 为每个测试创建独立的临时目录 */
function freshDir(): string {
  testCounter++;
  return path.join(baseTmpDir, `test-${testCounter}`);
}

async function cleanupTmpDir(): Promise<void> {
  try {
    await fs.rm(baseTmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  baseTmpDir = path.join(os.tmpdir(), `firmclaw-audit-test-${Date.now()}`);

  console.log('AuditLogger + AuditQuery Tests');
  console.log('==============================');

  // ──── AuditLogger 基础 ────

  describe('AuditLogger - Basic write', () => {
    it('writes a single record', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      const id = await logger.log({
        eventType: 'tool_execution',
        toolName: 'bash',
        args: { command: 'ls' },
        riskLevel: 'low',
        result: 'success',
        durationMs: 10,
      });
      assertEqual(id, 'aud_001', 'first id');

      const content = await fs.readFile(path.join(dir, 'audit.jsonl'), 'utf-8');
      const entry = JSON.parse(content.trim()) as AuditEntry;
      assertEqual(entry.id, 'aud_001', 'id in file');
      assertEqual(entry.eventType, 'tool_execution', 'eventType');
      assert(entry.timestamp, 'timestamp exists');
    });

    it('generates auto-increment IDs', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      const id1 = await logger.log({ eventType: 'session_start', result: 'started' });
      const id2 = await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });
      const id3 = await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });
      assertEqual(id1, 'aud_001', 'first');
      assertEqual(id2, 'aud_002', 'second');
      assertEqual(id3, 'aud_003', 'third');
    });

    it('truncates long output', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({
        eventType: 'tool_execution',
        toolName: 'bash',
        output: 'A'.repeat(1000),
        result: 'success',
      });

      const query = new AuditQuery(dir);
      const entries = await query.query();
      assert(entries[0].output!.length <= 550, 'output truncated');
      assert(entries[0].output!.includes('...[truncated]'), 'has truncation marker');
    });

    it('auto-creates directory and file', async () => {
      const dir = freshDir();
      const nestedDir = path.join(dir, 'nested', 'dir');
      const logger = new AuditLogger(nestedDir);
      await logger.log({ eventType: 'session_start', result: 'started' });

      const exists = await fs.access(path.join(nestedDir, 'audit.jsonl')).then(() => true).catch(() => false);
      assert(exists, 'file should exist');
    });
  });

  // ──── AuditLogger 批量写入 ────

  describe('AuditLogger - Batch write', () => {
    it('writes multiple records in one call', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      const ids = await logger.logBatch([
        { eventType: 'tool_execution', toolName: 'bash', result: 'success' },
        { eventType: 'tool_execution', toolName: 'bash', result: 'success' },
        { eventType: 'tool_execution', toolName: 'bash', result: 'success' },
      ]);
      assertEqual(ids.length, 3, '3 ids returned');
      assertEqual(ids[0], 'aud_001', 'first id');
      assertEqual(ids[2], 'aud_003', 'last id');
    });

    it('empty batch returns empty array', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      const ids = await logger.logBatch([]);
      assertEqual(ids.length, 0, 'empty result');
    });
  });

  // ──── AuditQuery 查询 ────

  describe('AuditQuery - Filtering', () => {
    it('filters by toolName', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });
      await logger.log({ eventType: 'tool_execution', toolName: 'read_file', result: 'success' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });

      const query = new AuditQuery(dir);
      const results = await query.query({ toolName: 'bash' });
      assertEqual(results.length, 2, '2 bash entries');
      assertEqual(results[0].toolName, 'bash', 'tool name');
    });

    it('filters by eventType', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });
      await logger.log({ eventType: 'approval', toolName: 'bash', result: 'approved', approvedBy: 'user' });
      await logger.log({ eventType: 'prompt_injection', toolName: 'read_file', result: 'cleaned' });

      const query = new AuditQuery(dir);
      const results = await query.query({ eventType: 'approval' });
      assertEqual(results.length, 1, '1 approval entry');
    });

    it('filters by riskLevel', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'low', result: 'success' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'medium', result: 'success' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'high', result: 'success' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'low', result: 'success' });

      const query = new AuditQuery(dir);
      const results = await query.query({ riskLevel: 'high' });
      assertEqual(results.length, 1, '1 high risk entry');
    });

    it('filters by sessionId', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', sessionId: 'sess_1', toolName: 'bash', result: 'success' });
      await logger.log({ eventType: 'tool_execution', sessionId: 'sess_2', toolName: 'bash', result: 'success' });
      await logger.log({ eventType: 'tool_execution', sessionId: 'sess_1', toolName: 'bash', result: 'success' });

      const query = new AuditQuery(dir);
      const results = await query.query({ sessionId: 'sess_1' });
      assertEqual(results.length, 2, '2 entries for sess_1');
    });

    it('applies limit', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      for (let i = 0; i < 10; i++) {
        await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });
      }

      const query = new AuditQuery(dir);
      const results = await query.query({ limit: 3 });
      assertEqual(results.length, 3, 'limited to 3');
    });

    it('filters deniedOnly', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'approval', toolName: 'bash', result: 'approved', approvedBy: 'user' });
      await logger.log({ eventType: 'approval', toolName: 'bash', result: 'denied', approvedBy: 'user' });
      await logger.log({ eventType: 'approval', toolName: 'bash', result: 'rejected', approvedBy: 'policy' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'success' });

      const query = new AuditQuery(dir);
      const results = await query.query({ deniedOnly: true });
      assertEqual(results.length, 2, '2 denied entries');
    });

    it('results are sorted by timestamp desc', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'first' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'second' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'third' });

      const query = new AuditQuery(dir);
      const results = await query.query();
      assertEqual(results[0].result, 'third', 'newest first');
      assertEqual(results[2].result, 'first', 'oldest last');
    });
  });

  // ──── AuditQuery 统计 ────

  describe('AuditQuery - Stats', () => {
    it('computes stats correctly', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'low', result: 'success', durationMs: 10 });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', riskLevel: 'medium', result: 'success', durationMs: 20 });
      await logger.log({ eventType: 'approval', toolName: 'bash', riskLevel: 'high', result: 'denied', durationMs: 5000 });
      await logger.log({ eventType: 'tool_execution', toolName: 'read_file', riskLevel: 'low', result: 'success', durationMs: 5 });
      await logger.log({ eventType: 'session_start', result: 'started' });

      const query = new AuditQuery(dir);
      const stats = await query.stats();

      assertEqual(stats.totalEntries, 5, 'total');
      assertEqual(stats.byType['tool_execution'], 3, 'byType tool_execution');
      assertEqual(stats.byType['approval'], 1, 'byType approval');
      assertEqual(stats.byTool['bash'], 3, 'byTool bash');
      assertEqual(stats.byRiskLevel['low'], 2, 'byRiskLevel low');
      assertEqual(stats.deniedCount, 1, 'deniedCount');
      assertEqual(stats.totalDurationMs, 5035, 'totalDurationMs');
    });
  });

  // ──── AuditQuery CSV 导出 ────

  describe('AuditQuery - CSV export', () => {
    it('exports to CSV format', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({
        eventType: 'tool_execution',
        sessionId: 'sess_1',
        toolName: 'bash',
        riskLevel: 'low',
        result: 'success',
        durationMs: 10,
        output: 'file1\nfile2',
      });

      const query = new AuditQuery(dir);
      const csv = await query.exportCSV();
      const lines = csv.split('\n');

      assert(lines.length >= 2, 'header + at least 1 row');
      assert(lines[0].startsWith('id,timestamp,sessionId'), 'has header');
      assert(lines[1].includes('aud_001'), 'has id');
      assert(lines[1].includes('bash'), 'has toolName');
    });
  });

  // ──── 边界情况 ────

  describe('Edge cases', () => {
    it('query on non-existent file returns empty', async () => {
      const dir = freshDir();
      const query = new AuditQuery(path.join(dir, 'nonexistent'));
      const results = await query.query();
      assertEqual(results.length, 0, 'empty result');
    });

    it('stats on non-existent file returns zeros', async () => {
      const dir = freshDir();
      const query = new AuditQuery(path.join(dir, 'nonexistent'));
      const stats = await query.stats();
      assertEqual(stats.totalEntries, 0, 'total is 0');
    });

    it('tolerates corrupted lines', async () => {
      const dir = freshDir();
      const logPath = path.join(dir, 'audit.jsonl');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(logPath,
        '{"id":"aud_001","eventType":"tool_execution","result":"success"}\n' +
        'CORRUPTED LINE\n' +
        '{"id":"aud_002","eventType":"tool_execution","result":"success"}\n',
        'utf-8',
      );

      const query = new AuditQuery(dir);
      const results = await query.query();
      assertEqual(results.length, 2, '2 valid entries');
    });

    it('no filter returns all entries', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'a' });
      await logger.log({ eventType: 'tool_execution', toolName: 'bash', result: 'b' });

      const query = new AuditQuery(dir);
      const results = await query.query();
      assertEqual(results.length, 2, 'all entries');
    });

    it('getFilePath returns correct path', async () => {
      const dir = freshDir();
      const logger = new AuditLogger(dir);
      const fp = logger.getFilePath();
      assert(fp.includes('audit.jsonl'), 'path ends with audit.jsonl');
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
