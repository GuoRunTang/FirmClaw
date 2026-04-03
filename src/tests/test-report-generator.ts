/**
 * src/tests/test-report-generator.ts
 *
 * ReportGenerator 单元测试。
 *
 * v1.0: 初始实现
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ReportGenerator } from '../issues/report-generator.js';
import type { IssueRecord, IssueSummary } from '../issues/types.js';

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

function makeRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: 'iss_test_1',
    category: 'PERM',
    subCategory: 'perm_denied',
    severity: 'error',
    sessionId: 'test-session',
    sessionTitle: 'Test Session',
    description: 'Permission denied',
    timestamp: '2026-04-03T10:00:00.000Z',
    resolved: false,
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  console.log('ReportGenerator Tests');
  console.log('=====================');

  const tmpDir = path.join(os.tmpdir(), `firmclaw-test-report-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    describe('generateSessionReport', () => {
      it('generates report with header', () => {
        const gen = new ReportGenerator();
        const report = gen.generateSessionReport('sess-1', [makeRecord()], { title: 'My Session' });
        assert(report.includes('# 会话问题报告'), 'should have title');
        assert(report.includes('My Session'), 'should have session title');
        assert(report.includes('`sess-1`'), 'should have session ID');
      });
      it('shows overview table', () => {
        const gen = new ReportGenerator();
        const report = gen.generateSessionReport('s1', [makeRecord(), makeRecord({ resolved: true })]);
        assert(report.includes('| 总问题数 | 2 |'), 'should show total');
        assert(report.includes('| 已解决 | 1 |'), 'should show resolved');
        assert(report.includes('| 解决率 | 50.0% |'), 'should show rate');
      });
      it('shows empty state for no issues', () => {
        const gen = new ReportGenerator();
        const report = gen.generateSessionReport('s1', []);
        assert(report.includes('未检测到任何问题'), 'should show empty message');
      });
      it('shows category statistics', () => {
        const gen = new ReportGenerator();
        const records = [
          makeRecord({ category: 'PERM' }),
          makeRecord({ category: 'PERM', id: 'iss_test_2' }),
          makeRecord({ category: 'API', subCategory: 'api_timeout', id: 'iss_test_3' }),
        ];
        const report = gen.generateSessionReport('s1', records);
        assert(report.includes('权限问题 (PERM)'), 'should show PERM label');
        assert(report.includes('| 2 |'), 'should show PERM count');
      });
      it('shows severity statistics', () => {
        const gen = new ReportGenerator();
        const records = [
          makeRecord({ severity: 'error' }),
          makeRecord({ severity: 'warning', id: 'iss_test_2' }),
          makeRecord({ severity: 'info', id: 'iss_test_3' }),
        ];
        const report = gen.generateSessionReport('s1', records);
        assert(report.includes('错误'), 'should show error label');
        assert(report.includes('警告'), 'should show warning label');
        assert(report.includes('信息'), 'should show info label');
      });
      it('shows issue details', () => {
        const gen = new ReportGenerator();
        const records = [
          makeRecord({ toolName: 'bash', argsSummary: 'command=ls' }),
        ];
        const report = gen.generateSessionReport('s1', records);
        assert(report.includes('PERM-001'), 'should have issue ID');
        assert(report.includes('bash'), 'should show tool name');
        assert(report.includes('command=ls'), 'should show args summary');
        assert(report.includes('❌ 未解决'), 'should show unresolved status');
      });
      it('shows resolved status', () => {
        const gen = new ReportGenerator();
        const records = [makeRecord({ resolved: true })];
        const report = gen.generateSessionReport('s1', records);
        assert(report.includes('✅ 已解决'), 'should show resolved status');
      });
    });

    describe('generateGlobalSummary', () => {
      it('generates summary with header', () => {
        const gen = new ReportGenerator();
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 10,
          bySeverity: { error: 5, warning: 3, info: 2 },
          byCategory: [{ category: 'PERM', label: '权限问题', count: 5, subCategories: [] }],
          bySession: [{ sessionId: 's1', sessionTitle: 'S1', issueCount: 5 }],
          resolveRate: 0.6,
        };
        const report = gen.generateGlobalSummary(summary);
        assert(report.includes('# FirmClaw 问题追踪全局汇总'), 'should have global title');
        assert(report.includes('| 总问题数 | 10 |'), 'should show total');
        assert(report.includes('| 解决率 | 60.0% |'), 'should show resolve rate');
      });
      it('shows category ranking', () => {
        const gen = new ReportGenerator();
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 10,
          bySeverity: { error: 10, warning: 0, info: 0 },
          byCategory: [
            { category: 'PERM', label: '权限问题', count: 5, subCategories: [] },
            { category: 'API', label: 'LLM API 问题', count: 3, subCategories: [] },
            { category: 'TOOL', label: '工具执行问题', count: 2, subCategories: [] },
          ],
          bySession: [],
          resolveRate: 0,
        };
        const report = gen.generateGlobalSummary(summary);
        assert(report.includes('| 1 |'), 'should have ranking');
        assert(report.includes('权限问题 (PERM)'), 'should show PERM');
      });
      it('shows top sessions', () => {
        const gen = new ReportGenerator();
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 8,
          bySeverity: { error: 8, warning: 0, info: 0 },
          byCategory: [{ category: 'ENV', label: '环境问题', count: 8, subCategories: [] }],
          bySession: [
            { sessionId: 'aaaa', sessionTitle: 'Session A', issueCount: 5 },
            { sessionId: 'bbbb', sessionTitle: 'Session B', issueCount: 3 },
          ],
          resolveRate: 0,
        };
        const report = gen.generateGlobalSummary(summary);
        assert(report.includes('Session A'), 'should show session title');
        assert(report.includes('| 5 |'), 'should show session count');
      });
      it('shows improvement suggestions', () => {
        const gen = new ReportGenerator();
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 10,
          bySeverity: { error: 10, warning: 0, info: 0 },
          byCategory: [
            { category: 'DEP', label: '依赖问题', count: 5, subCategories: [] },
            { category: 'ENCODING', label: '编码问题', count: 3, subCategories: [] },
            { category: 'API', label: 'LLM API 问题', count: 2, subCategories: [] },
          ],
          bySession: [],
          resolveRate: 0,
        };
        const report = gen.generateGlobalSummary(summary);
        assert(report.includes('改进建议'), 'should have suggestions section');
        assert(report.includes('DEP'), 'should suggest for DEP');
        assert(report.includes('依赖'), 'should mention dependencies');
      });
      it('shows empty state for no issues', () => {
        const gen = new ReportGenerator();
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 0,
          bySeverity: { error: 0, warning: 0, info: 0 },
          byCategory: [],
          bySession: [],
          resolveRate: 0,
        };
        const report = gen.generateGlobalSummary(summary);
        assert(report.includes('均未检测到问题'), 'should show empty message');
      });
    });

    describe('writeSessionReport', () => {
      it('writes file to output directory', () => {
        const gen = new ReportGenerator(tmpDir);
        const filePath = gen.writeSessionReport('write-test', [makeRecord()], { title: 'Write Test' });
        assert(fs.existsSync(filePath), 'file should exist');
        assert(filePath.endsWith('session-write-test.md'), 'file name should be correct');
        const content = fs.readFileSync(filePath, 'utf-8');
        assert(content.includes('# 会话问题报告'), 'should have content');
      });
    });

    describe('writeGlobalSummary', () => {
      it('writes summary file', () => {
        const gen = new ReportGenerator(tmpDir);
        const summary: IssueSummary = {
          from: '2026-04-01', to: '2026-04-03',
          totalIssues: 1,
          bySeverity: { error: 1, warning: 0, info: 0 },
          byCategory: [{ category: 'PERM', label: '权限问题', count: 1, subCategories: [] }],
          bySession: [],
          resolveRate: 0,
        };
        const filePath = gen.writeGlobalSummary(summary);
        assert(fs.existsSync(filePath), 'file should exist');
        assert(filePath.endsWith('summary.md'), 'file name should be correct');
        const content = fs.readFileSync(filePath, 'utf-8');
        assert(content.includes('全局汇总'), 'should have global summary content');
      });
    });

    describe('error handling', () => {
      it('throws when output dir not set for write', () => {
        const gen = new ReportGenerator();
        let threw = false;
        try {
          gen.writeSessionReport('x', []);
        } catch {
          threw = true;
        }
        assert(threw, 'should throw when no output dir');
      });
    });

    describe('markdown escaping', () => {
      it('escapes special characters in descriptions', () => {
        const gen = new ReportGenerator();
        const report = gen.generateSessionReport('s1', [
          makeRecord({ description: 'Error with | pipe * bold ` code \\ backslash' }),
        ]);
        // Should not have unescaped table pipes in description
        assert(!report.includes('| pipe * bold ` code \\ backslash'), 'should escape markdown');
      });
    });

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ──── 运行 ────

runTests().then(async () => {
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
