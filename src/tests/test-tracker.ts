/**
 * src/tests/test-tracker.ts
 *
 * IssueTracker 单元测试。
 *
 * v1.0: 初始实现
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { IssueTracker } from '../issues/tracker.js';
import { EventStream } from '../utils/event-stream.js';

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
  console.log('IssueTracker Tests');
  console.log('==================');

  const tmpDir = path.join(os.tmpdir(), `firmclaw-test-tracker-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    describe('constructor and enable/disable', () => {
      it('creates tracker with default config', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        assert(t.isEnabled(), 'should be enabled by default');
      });
      it('can be disabled', () => {
        const t = new IssueTracker({ storageDir: tmpDir, enabled: false });
        assert(!t.isEnabled(), 'should be disabled');
      });
      it('setEnabled toggles tracking', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setEnabled(false);
        assert(!t.isEnabled(), 'should be disabled');
        t.setEnabled(true);
        assert(t.isEnabled(), 'should be enabled');
      });
    });

    describe('setSession', () => {
      it('stores session context', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('sess-123', 'Test Session');
        assertEqual(t.getCurrentSessionId(), 'sess-123');
      });
    });

    describe('recordFromText', () => {
      it('classifies and records an error', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('s1', 'Test');
        const r = t.recordFromText('Permission denied: access /etc/shadow');
        assert(r !== null, 'should return a record');
        assertEqual(r!.category, 'PERM');
        assertEqual(r!.sessionId, 's1');
        assert(r!.id.startsWith('iss_'), 'id should start with iss_');
        assertEqual(r!.resolved, false);
      });
      it('returns null for non-matching text', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        const r = t.recordFromText('Everything is fine, no errors here');
        assertEqual(r, null);
      });
      it('returns null when disabled', () => {
        const t = new IssueTracker({ storageDir: tmpDir, enabled: false });
        const r = t.recordFromText('Permission denied');
        assertEqual(r, null);
      });
      it('uses provided sessionId over current', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('default-session', 'Default');
        const r = t.recordFromText('Permission denied', { sessionId: 'override-session' });
        assert(r !== null);
        assertEqual(r!.sessionId, 'override-session');
      });
      it('records tool name and args summary', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        const r = t.recordFromText('ENOENT: no such file', {
          toolName: 'bash',
          argsSummary: 'command=ls /tmp',
        });
        assert(r !== null);
        assertEqual(r!.toolName, 'bash');
        assertEqual(r!.argsSummary, 'command=ls /tmp');
      });
      it('truncates long descriptions', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        const longText = 'Permission denied: ' + 'x'.repeat(600);
        const r = t.recordFromText(longText);
        assert(r !== null);
        assert(r!.description.length <= 500, 'description should be truncated');
      });
    });

    describe('createAfterHook', () => {
      it('records when isError is true', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('hook-sess', 'Hook Test');
        const hook = t.createAfterHook();

        hook({
          toolName: 'bash',
          args: { command: 'rm -rf /' },
          result: { content: 'Permission denied', isError: true },
          toolContext: { sessionId: 'hook-sess', workDir: '/tmp' },
        });

        const records = t.getStore().getBySession('hook-sess');
        assertEqual(records.length, 1);
        assertEqual(records[0].category, 'PERM');
        assertEqual(records[0].toolName, 'bash');
      });
      it('does not record successful tool calls', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('ok-sess', 'OK Test');
        const hook = t.createAfterHook();

        hook({
          toolName: 'bash',
          args: { command: 'ls' },
          result: { content: 'file1.txt\nfile2.txt', isError: false },
          toolContext: { sessionId: 'ok-sess', workDir: '/tmp' },
        });

        assertEqual(t.getStore().getBySession('ok-sess').length, 0);
      });
      it('records when result content has error keywords even without isError', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('implicit-sess', 'Implicit');
        const hook = t.createAfterHook();

        hook({
          toolName: 'bash',
          args: { command: 'cat /etc/shadow' },
          result: { content: 'cat: /etc/shadow: Permission denied', isError: false },
          toolContext: { sessionId: 'implicit-sess', workDir: '/tmp' },
        });

        const records = t.getStore().getBySession('implicit-sess');
        assertEqual(records.length, 1);
        assertEqual(records[0].category, 'PERM');
      });
      it('does not record when result is undefined', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('no-result', 'No Result');
        const hook = t.createAfterHook();

        hook({
          toolName: 'bash',
          args: {},
          toolContext: { sessionId: 'no-result', workDir: '/tmp' },
        });

        assertEqual(t.getStore().getBySession('no-result').length, 0);
      });
      it('does not record when disabled', () => {
        const t = new IssueTracker({ storageDir: tmpDir, enabled: false });
        t.setSession('disabled', 'Disabled');
        const hook = t.createAfterHook();

        hook({
          toolName: 'bash',
          args: {},
          result: { content: 'Permission denied', isError: true },
          toolContext: { sessionId: 'disabled', workDir: '/tmp' },
        });

        assertEqual(t.getStore().getBySession('disabled').length, 0);
      });
      it('includes args summary in record', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('args-sess', 'Args');
        const hook = t.createAfterHook();

        hook({
          toolName: 'read_file',
          args: { filePath: '/tmp/test.txt', encoding: 'utf-8', limit: 100 },
          result: { content: 'ENOENT: no such file', isError: true },
          toolContext: { sessionId: 'args-sess', workDir: '/tmp' },
        });

        const records = t.getStore().getBySession('args-sess');
        assert(records.length > 0, 'should have a record');
        assert(records[0].argsSummary!.includes('filePath='), 'should include args');
      });
    });

    describe('bindEvents', () => {
      it('records from error event', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('evt-sess', 'Event Test');
        const events = new EventStream();

        t.bindEvents(events);
        events.emit('error', 'LLM API error: ECONNREFUSED');

        const records = t.getStore().getBySession('evt-sess');
        assert(records.length >= 1, 'should record error event');
      });
      it('records from context_trimmed event', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('trim-sess', 'Trim Test');
        const events = new EventStream();

        t.bindEvents(events);
        events.emit('context_trimmed', { originalTokens: 10000, trimmedTokens: 8000 });

        const records = t.getStore().getBySession('trim-sess');
        assert(records.length >= 1, 'should record context_trimmed');
        assertEqual(records[0].category, 'CONTEXT');
      });
      it('records from approval_denied event', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('appr-sess', 'Approval Test');
        const events = new EventStream();

        t.bindEvents(events);
        events.emit('approval_denied', { toolName: 'bash', args: { command: 'rm -rf /' }, reason: 'User approval rejected the command execution' });

        const records = t.getStore().getBySession('appr-sess');
        assert(records.length >= 1, 'should record approval_denied');
      });
      it('records from agent_status max_turns', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('max-sess', 'Max Turns Test');
        const events = new EventStream();

        t.bindEvents(events);
        events.emit('agent_status', { status: 'max_turns' });

        const records = t.getStore().getBySession('max-sess');
        assert(records.length >= 1, 'should record max_turns');
        assertEqual(records[0].category, 'AGENT');
      });
      it('does not record when disabled', () => {
        const t = new IssueTracker({ storageDir: tmpDir, enabled: false });
        t.setSession('disabled-evt', 'Disabled');
        const events = new EventStream();

        t.bindEvents(events);
        events.emit('error', 'Permission denied');

        assertEqual(t.getStore().getBySession('disabled-evt').length, 0);
      });
    });

    describe('getSessionSummary', () => {
      it('aggregates by category', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('agg-sess', 'Agg Test');
        t.recordFromText('Permission denied');
        t.recordFromText('ENOENT: no such file');
        t.recordFromText('EPERM: access denied');
        t.recordFromText('ENOENT: file not found');

        const summary = t.getSessionSummary('agg-sess');
        assert(summary.length >= 2, 'should have at least 2 categories');

        const envCat = summary.find(c => c.category === 'ENV');
        const permCat = summary.find(c => c.category === 'PERM');
        assert(envCat !== undefined, 'should have ENV');
        assertEqual(envCat!.count, 2);
        assert(permCat !== undefined, 'should have PERM');
        assertEqual(permCat!.count, 2);
      });
    });

    describe('getGlobalSummary', () => {
      it('returns comprehensive summary', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        t.setSession('s1', 'Session 1');
        t.recordFromText('Permission denied');
        t.recordFromText('ENOENT: no such file or directory');

        t.setSession('s2', 'Session 2');
        t.recordFromText('Command timed out after 30000ms');
        t.recordFromText('Permission denied');
        t.recordFromText('Permission denied');

        const summary = t.getGlobalSummary();
        assertEqual(summary.totalIssues, 5);
        assertEqual(summary.resolveRate, 0);
        assert(summary.byCategory.length >= 2);
        assertEqual(summary.bySession.length, 2);
        // Session 2 should have more issues
        assert(summary.bySession[0].issueCount >= 3);
      });
    });

    describe('scanSessions', () => {
      it('scans JSONL files and extracts issues', async () => {
        // Create a mock session file
        const sessionDir = path.join(tmpDir, 'sessions');
        fs.mkdirSync(sessionDir, { recursive: true });

        const sessionContent = [
          JSON.stringify({ id: 'scan-test-1', title: 'Scan Test', role: '#META' }),
          JSON.stringify({ role: 'user', content: 'Run the command' }),
          JSON.stringify({ role: 'assistant', content: 'Let me try' }),
          JSON.stringify({ role: 'tool', content: 'Permission denied: access /etc/shadow', tool_call_id: 'tc1' }),
          JSON.stringify({ role: 'tool', content: 'Everything is fine here', tool_call_id: 'tc2' }),
          JSON.stringify({ role: 'tool', content: 'ENOENT: no such file or directory', tool_call_id: 'tc3' }),
          JSON.stringify({ role: 'assistant', content: 'Done' }),
        ].join('\n');

        fs.writeFileSync(path.join(sessionDir, 'scan-test-1.jsonl'), sessionContent, 'utf-8');

        const t = new IssueTracker({ storageDir: tmpDir });
        const result = await t.scanSessions(sessionDir);

        assertEqual(result.scanned, 1);
        assertEqual(result.issuesFound, 2); // Permission denied + ENOENT
        assertEqual(t.getStore().getBySession('scan-test-1').length, 2);
      });
      it('handles non-existent directory gracefully', async () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        const result = await t.scanSessions(path.join(tmpDir, 'nonexistent'));
        assertEqual(result.scanned, 0);
        assertEqual(result.issuesFound, 0);
      });
      it('handles corrupt JSONL lines gracefully', async () => {
        const sessionDir = path.join(tmpDir, 'sessions-corrupt');
        fs.mkdirSync(sessionDir, { recursive: true });

        const content = [
          'not valid json',
          JSON.stringify({ role: 'tool', content: 'Permission denied' }),
          '{broken json',
        ].join('\n');

        fs.writeFileSync(path.join(sessionDir, 'corrupt.jsonl'), content, 'utf-8');

        const t = new IssueTracker({ storageDir: tmpDir });
        const result = await t.scanSessions(sessionDir);
        assertEqual(result.scanned, 1);
        assertEqual(result.issuesFound, 1); // only the valid line
      });
    });

    describe('getStore / getClassifier', () => {
      it('returns references', () => {
        const t = new IssueTracker({ storageDir: tmpDir });
        assert(t.getStore() !== null, 'store should exist');
        assert(t.getClassifier() !== null, 'classifier should exist');
        assert(t.getClassifier().ruleCount > 0, 'classifier should have rules');
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
