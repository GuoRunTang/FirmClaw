/**
 * src/tests/test-approval-gateway.ts
 *
 * ApprovalGateway 单元测试。
 *
 * v4.1: 初始实现
 *
 * 测试覆盖：
 * - 自动批准：auto 模式、autoApproveTools、risk-based 低风险
 * - 人工审批：resolve 批准/拒绝、超时自动拒绝
 * - 边界情况：无挂起请求时 resolve、多次 request 覆盖
 * - 历史记录：审批记录保存和查询
 * - 风险等级判定：permissions.ts 的 assessCommandRisk
 */

import { ApprovalGateway } from '../agent/approval-gateway.js';
import { DefaultPermissionPolicy } from '../tools/permissions.js';

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
      console.log(`    ✓ ${name}`);
    } catch (err: unknown) {
      failed++;
      console.error(`    ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('ApprovalGateway Tests');
  console.log('=====================');

  // ──── 自动批准 ────

  describe('Auto-approval scenarios', () => {
    it('auto mode: all tools auto-approved', async () => {
      const gateway = new ApprovalGateway({ mode: 'auto' });
      const result = await gateway.request('bash', { command: 'rm -rf /' }, 'high');
      assertEqual(result, 'approved', 'result');
      assertEqual(gateway.hasPending(), false, 'no pending');
    });

    it('autoApproveTools: specified tool auto-approved regardless of risk', async () => {
      const gateway = new ApprovalGateway({
        mode: 'risk-based',
        autoApproveTools: ['read_file'],
      });
      const result = await gateway.request('read_file', { path: '/etc/passwd' }, 'high');
      assertEqual(result, 'approved', 'result');
    });

    it('risk-based mode: low risk auto-approved', async () => {
      const gateway = new ApprovalGateway({ mode: 'risk-based' });
      const result = await gateway.request('bash', { command: 'ls' }, 'low');
      assertEqual(result, 'approved', 'result');
    });

    it('risk-based mode: medium risk requires approval (blocks)', async () => {
      const gateway = new ApprovalGateway({ mode: 'risk-based' });
      // 发起请求后应该挂起，我们用 resolve 来解决
      let resolved = false;
      const promise = gateway.request('bash', { command: 'npm install' }, 'medium').then((r) => {
        resolved = true;
        return r;
      });
      // 给微任务队列一点时间
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assertEqual(gateway.hasPending(), true, 'should be pending');
      assertEqual(resolved, false, 'not yet resolved');

      gateway.resolve('approved');
      const result = await promise;
      assertEqual(result, 'approved', 'result after approve');
      assertEqual(gateway.hasPending(), false, 'no pending after resolve');
    });

    it('strict mode: even low risk requires approval', async () => {
      const gateway = new ApprovalGateway({ mode: 'strict' });
      const promise = gateway.request('read_file', { path: '.' }, 'low');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assertEqual(gateway.hasPending(), true, 'should be pending');
      gateway.resolve('approved');
      const result = await promise;
      assertEqual(result, 'approved', 'result');
    });
  });

  // ──── 人工审批：批准 ────

  describe('Manual approval: approve', () => {
    it('user approves → tool continues', async () => {
      const gateway = new ApprovalGateway({ mode: 'strict' });
      const promise = gateway.request('bash', { command: 'npm install' }, 'medium');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const pending = gateway.getPendingRequest();
      assert(pending !== null, 'should have pending request');
      assertEqual(pending!.toolName, 'bash', 'tool name');
      assertEqual(pending!.riskLevel, 'medium', 'risk level');

      const ok = gateway.resolve('approved');
      assertEqual(ok, true, 'resolve should succeed');
      const result = await promise;
      assertEqual(result, 'approved', 'result');
    });
  });

  // ──── 人工审批：拒绝 ────

  describe('Manual approval: deny', () => {
    it('user denies → tool skipped', async () => {
      const gateway = new ApprovalGateway({ mode: 'strict' });
      const promise = gateway.request('bash', { command: 'rm -rf build/' }, 'high');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      gateway.resolve('denied');
      const result = await promise;
      assertEqual(result, 'denied', 'result');
    });
  });

  // ──── 超时 ────

  describe('Timeout', () => {
    it('timeout → auto-deny', async () => {
      const gateway = new ApprovalGateway({ mode: 'strict', timeoutMs: 100 });
      const promise = gateway.request('bash', { command: 'rm -rf /' }, 'high');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assertEqual(gateway.hasPending(), true, 'should be pending');

      const result = await promise;
      assertEqual(result, 'timeout', 'result should be timeout');
      assertEqual(gateway.hasPending(), false, 'no pending after timeout');
    });
  });

  // ──── 边界情况 ────

  describe('Edge cases', () => {
    it('resolve when no pending request → returns false', () => {
      const gateway = new ApprovalGateway({ mode: 'strict' });
      const ok = gateway.resolve('approved');
      assertEqual(ok, false, 'should return false');
    });

    it('getPendingRequest when no pending → returns null', () => {
      const gateway = new ApprovalGateway({ mode: 'auto' });
      assertEqual(gateway.getPendingRequest(), null, 'should be null');
    });

    it('getMode / setMode', () => {
      const gateway = new ApprovalGateway({ mode: 'auto' });
      assertEqual(gateway.getMode(), 'auto', 'initial mode');
      gateway.setMode('strict');
      assertEqual(gateway.getMode(), 'strict', 'after setMode');
    });

    it('getTimeoutMs', () => {
      const gateway = new ApprovalGateway({ timeoutMs: 60000 });
      assertEqual(gateway.getTimeoutMs(), 60000, 'timeout');
    });
  });

  // ──── 历史记录 ────

  describe('History', () => {
    it('auto-approved requests are recorded', async () => {
      const gateway = new ApprovalGateway({ mode: 'auto' });
      await gateway.request('bash', { command: 'ls' }, 'low');
      await gateway.request('read_file', { path: '.' }, 'low');
      const history = gateway.getHistory();
      assertEqual(history.length, 2, 'history length');
      assertEqual(history[0].request.toolName, 'bash', 'first tool');
      assertEqual(history[0].result, 'approved', 'first result');
      assertEqual(history[1].request.toolName, 'read_file', 'second tool');
    });

    it('manual approvals are recorded', async () => {
      const gateway = new ApprovalGateway({ mode: 'strict' });
      const p1 = gateway.request('bash', { command: 'rm x' }, 'high');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      gateway.resolve('denied');
      await p1;

      const p2 = gateway.request('bash', { command: 'npm i' }, 'medium');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      gateway.resolve('approved');
      await p2;

      const history = gateway.getHistory();
      assertEqual(history.length, 2, 'history length');
      assertEqual(history[0].result, 'denied', 'first denied');
      assertEqual(history[1].result, 'approved', 'second approved');
    });
  });

  // ──── 自定义 requireApprovalFor ────

  describe('Custom requireApprovalFor', () => {
    it('only high risk requires approval', async () => {
      const gateway = new ApprovalGateway({
        mode: 'risk-based',
        requireApprovalFor: ['high'],
      });
      // medium 应该自动批准
      const r1 = await gateway.request('bash', { command: 'npm install' }, 'medium');
      assertEqual(r1, 'approved', 'medium auto-approved');
    });

    it('low and medium and high all require approval', async () => {
      const gateway = new ApprovalGateway({
        mode: 'risk-based',
        requireApprovalFor: ['low', 'medium', 'high'],
      });
      // low 也需要审批
      const promise = gateway.request('bash', { command: 'ls' }, 'low');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assertEqual(gateway.hasPending(), true, 'low should need approval');
      gateway.resolve('approved');
      await promise;
    });
  });

  // ──── DefaultPermissionPolicy 风险等级判定 ────

  describe('DefaultPermissionPolicy risk level assessment', () => {
    it('read_file → low risk', () => {
      const policy = new DefaultPermissionPolicy({ allowedPaths: ['/tmp'] });
      const result = policy.checkFileAccess('/tmp/file.txt', 'read');
      assertEqual(result.allowed, true, 'allowed');
      assertEqual(result.riskLevel, 'low', 'risk');
    });

    it('write_file → medium risk', () => {
      const policy = new DefaultPermissionPolicy({ allowedPaths: ['/tmp'] });
      const result = policy.checkFileAccess('/tmp/file.txt', 'write');
      assertEqual(result.allowed, true, 'allowed');
      assertEqual(result.riskLevel, 'medium', 'risk');
    });

    it('edit_file → medium risk', () => {
      const policy = new DefaultPermissionPolicy({ allowedPaths: ['/tmp'] });
      const result = policy.checkFileAccess('/tmp/file.txt', 'edit');
      assertEqual(result.allowed, true, 'allowed');
      assertEqual(result.riskLevel, 'medium', 'risk');
    });

    it('bash ls → low risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('ls -la');
      assertEqual(result.riskLevel, 'low', 'risk');
    });

    it('bash git status → low risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('git status');
      assertEqual(result.riskLevel, 'low', 'risk');
    });

    it('bash npm install → medium risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('npm install lodash');
      assertEqual(result.riskLevel, 'medium', 'risk');
    });

    it('bash rm -rf → high risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('rm -rf build/');
      assertEqual(result.riskLevel, 'high', 'risk');
    });

    it('bash sudo → high risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('sudo apt install nginx');
      assertEqual(result.riskLevel, 'high', 'risk');
    });

    it('bash git commit → medium risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('git commit -m "feat: add feature"');
      assertEqual(result.riskLevel, 'medium', 'risk');
    });

    it('blacklisted command → not allowed + high risk', () => {
      const policy = new DefaultPermissionPolicy();
      const result = policy.checkCommand('rm -rf /');
      assertEqual(result.allowed, false, 'allowed');
      assertEqual(result.riskLevel, 'high', 'risk');
    });
  });
}

// ──── 运行 ────

runTests().then(async () => {
  // 先收集所有 it() 调用，再执行队列
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
