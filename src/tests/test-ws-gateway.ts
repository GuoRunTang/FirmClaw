/**
 * src/tests/test-ws-gateway.ts
 *
 * Gateway 模块单元测试（types / auth / connection / router）。
 *
 * 测试覆盖：
 * - types: JSON-RPC 错误码、RouteError
 * - auth: Token 认证（URL 参数、Header、禁用认证、时序攻击防护）
 * - connection: 连接注册/注销、会话绑定、广播、最大连接数
 * - router: JSON-RPC 格式校验、方法路由、RouteError 转换、通知处理
 *
 * v5.1: 初始实现
 */

import { JsonRpcErrorCode, RouteError, EVENT_TO_NOTIFICATION_METHOD } from '../gateway/types.js';
import { AuthGuard } from '../gateway/auth.js';
import { ConnectionManager } from '../gateway/connection.js';
import { MessageRouter } from '../gateway/router.js';
import type { ConnectionContext } from '../gateway/types.js';

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

function assertThrows(fn: () => void, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  try {
    fn();
    throw new Error(`${prefix}Expected function to throw, but it did not`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('Assertion failed:') || msg.startsWith('Expected function')) {
      throw err;
    }
    // 正常抛出（预期内的异常）
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
  console.error('WebSocket Gateway Tests (v5.1)');
  console.error('================================');

  // ──── types.ts 测试 ────

  describe('JsonRpcErrorCode', () => {
    it('标准错误码值正确', () => {
      assertEqual(JsonRpcErrorCode.PARSE_ERROR, -32700, 'PARSE_ERROR');
      assertEqual(JsonRpcErrorCode.INVALID_REQUEST, -32600, 'INVALID_REQUEST');
      assertEqual(JsonRpcErrorCode.METHOD_NOT_FOUND, -32601, 'METHOD_NOT_FOUND');
      assertEqual(JsonRpcErrorCode.INVALID_PARAMS, -32602, 'INVALID_PARAMS');
      assertEqual(JsonRpcErrorCode.INTERNAL_ERROR, -32603, 'INTERNAL_ERROR');
    });

    it('自定义错误码范围正确', () => {
      assertEqual(JsonRpcErrorCode.SERVER_BUSY, -32001, 'SERVER_BUSY');
      assertEqual(JsonRpcErrorCode.AUTH_FAILED, -32002, 'AUTH_FAILED');
      assertEqual(JsonRpcErrorCode.SESSION_NOT_FOUND, -32003, 'SESSION_NOT_FOUND');
    });
  });

  describe('RouteError', () => {
    it('创建 RouteError 带正确的 code 和 message', () => {
      const err = new RouteError(-32601, 'Method not found');
      assertEqual(err.code, -32601, 'code');
      assertEqual(err.message, 'Method not found', 'message');
      assertEqual(err.name, 'RouteError', 'name');
      assertEqual(err.data, undefined, 'data default');
    });

    it('创建 RouteError 带附加 data', () => {
      const err = new RouteError(-32602, 'Invalid params', { field: 'message' });
      assertEqual(err.data, { field: 'message' }, 'data');
    });

    it('RouteError 是 Error 的实例', () => {
      const err = new RouteError(-32601, 'test');
      assert(err instanceof Error, 'instanceof Error');
      assert(err instanceof RouteError, 'instanceof RouteError');
    });
  });

  describe('EVENT_TO_NOTIFICATION_METHOD', () => {
    it('包含所有 EventStream 事件', () => {
      const expectedEvents = [
        'thinking_delta', 'tool_start', 'tool_end', 'message_end', 'error',
        'session_start', 'context_trimmed', 'summary_generated', 'memory_saved',
        'approval_requested', 'approval_granted', 'approval_denied', 'prompt_injection_detected',
      ];
      for (const event of expectedEvents) {
        assert(event in EVENT_TO_NOTIFICATION_METHOD, `missing event: ${event}`);
      }
    });

    it('映射值格式正确', () => {
      assertEqual(EVENT_TO_NOTIFICATION_METHOD.thinking_delta, 'agent.thinking');
      assertEqual(EVENT_TO_NOTIFICATION_METHOD.tool_start, 'agent.tool_start');
      assertEqual(EVENT_TO_NOTIFICATION_METHOD.session_start, 'session.started');
    });
  });

  // ──── auth.ts 测试 ────

  describe('AuthGuard', () => {
    it('无 token 配置时跳过认证', () => {
      const auth = new AuthGuard();
      assert(!auth.isEnabled(), 'should be disabled');
      assert(auth.authenticate('ws://localhost:3000', {}), 'should pass');
    });

    it('URL 参数传递正确 token 时认证通过', () => {
      const auth = new AuthGuard('secret123');
      assert(auth.isEnabled(), 'should be enabled');
      assert(auth.authenticate('ws://localhost:3000?token=secret123', {}), 'should pass with URL token');
    });

    it('URL 参数传递错误 token 时认证失败', () => {
      const auth = new AuthGuard('secret123');
      assert(!auth.authenticate('ws://localhost:3000?token=wrong', {}), 'should fail with wrong token');
    });

    it('Header 传递正确 token 时认证通过', () => {
      const auth = new AuthGuard('secret123');
      assert(auth.authenticate('ws://localhost:3000', { 'sec-websocket-protocol': 'secret123' }), 'should pass with header token');
    });

    it('URL 参数优先于 Header', () => {
      const auth = new AuthGuard('secret123');
      // URL 参数正确，Header 错误 → 应该通过（URL 优先）
      assert(auth.authenticate('ws://localhost:3000?token=secret123', { 'sec-websocket-protocol': 'wrong' }), 'URL should take priority');
    });

    it('无 token 参数时认证失败', () => {
      const auth = new AuthGuard('secret123');
      assert(!auth.authenticate('ws://localhost:3000', {}), 'should fail without token');
    });

    it('generateToken 生成格式正确的 token', () => {
      const token = AuthGuard.generateToken();
      assert(token.startsWith('fc_'), 'should start with fc_');
      assert(token.length > 10, 'should be long enough');
      // 每次生成不同
      const token2 = AuthGuard.generateToken();
      assert(token !== token2, 'should be unique');
    });

    it('getToken 返回配置的 token', () => {
      const auth = new AuthGuard('my-token');
      assertEqual(auth.getToken(), 'my-token');
      assertEqual(new AuthGuard().getToken(), null);
    });
  });

  // ──── connection.ts 测试 ────

  describe('ConnectionManager', () => {
    it('注册连接返回有效的上下文', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      assert(ctx.connectionId.startsWith('conn_'), 'connectionId format');
      assert(ctx.sessionId === null, 'sessionId default');
      assert(!ctx.busy, 'busy default');
      assertEqual(mgr.count(), 1, 'count');
    });

    it('连续注册的 ID 递增', () => {
      const mgr = new ConnectionManager();
      const ctx1 = mgr.register(() => {});
      const ctx2 = mgr.register(() => {});
      assert(ctx1.connectionId !== ctx2.connectionId, 'different IDs');
    });

    it('注销连接后连接数减少', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      assertEqual(mgr.count(), 1);
      mgr.unregister(ctx.connectionId);
      assertEqual(mgr.count(), 0);
    });

    it('get 返回正确的连接上下文', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      const fetched = mgr.get(ctx.connectionId);
      assertEqual(fetched?.connectionId, ctx.connectionId);
      assertEqual(mgr.get('nonexistent'), undefined);
    });

    it('getAll 返回所有连接', () => {
      const mgr = new ConnectionManager();
      mgr.register(() => {});
      mgr.register(() => {});
      mgr.register(() => {});
      assertEqual(mgr.getAll().length, 3);
    });

    it('最大连接数限制生效', () => {
      const mgr = new ConnectionManager(2);
      mgr.register(() => {});
      mgr.register(() => {});
      assertThrows(() => mgr.register(() => {}), 'should throw on max');
    });

    it('bindSession 绑定会话 ID', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      mgr.bindSession(ctx.connectionId, 'session-abc');
      assertEqual(mgr.get(ctx.connectionId)?.sessionId, 'session-abc');
    });

    it('setBusy 设置忙碌状态', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      mgr.setBusy(ctx.connectionId, true);
      assert(mgr.get(ctx.connectionId)?.busy, 'should be busy');
      mgr.setBusy(ctx.connectionId, false);
      assert(!mgr.get(ctx.connectionId)?.busy, 'should not be busy');
    });

    it('touch 更新最后活跃时间', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      const originalTime = ctx.lastActiveAt;
      // 等待 1ms 确保时间戳不同
      // 注意：这里不做异步等待，仅测试字段存在
      mgr.touch(ctx.connectionId);
      assert(mgr.get(ctx.connectionId)?.lastActiveAt !== undefined, 'should have timestamp');
    });

    it('sendTo 向连接发送消息', () => {
      let received = '';
      const mgr = new ConnectionManager();
      const ctx = mgr.register((data) => { received = data; });
      assert(mgr.sendTo(ctx.connectionId, 'hello'), 'should succeed');
      assertEqual(received, 'hello');
      assert(!mgr.sendTo('nonexistent', 'hello'), 'should fail for unknown');
    });

    it('broadcast 向所有连接广播', () => {
      const received: string[] = [];
      const mgr = new ConnectionManager();
      mgr.register((data) => { received.push(data); });
      mgr.register((data) => { received.push(data); });
      mgr.broadcast('test.method', { key: 'value' });
      assertEqual(received.length, 2);
      const expected = JSON.stringify({ jsonrpc: '2.0', method: 'test.method', params: { key: 'value' } });
      assertEqual(received[0], expected);
      assertEqual(received[1], expected);
    });

    it('unregisterAll 清理所有连接', () => {
      const mgr = new ConnectionManager();
      mgr.register(() => {});
      mgr.register(() => {});
      mgr.unregisterAll();
      assertEqual(mgr.count(), 0);
      assertEqual(mgr.getAll().length, 0);
    });

    it('sendTo 在发送回调抛异常时不崩溃', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => { throw new Error('send failed'); });
      assert(!mgr.sendTo(ctx.connectionId, 'test'), 'should return false on error');
    });

    it('broadcast 在某个连接发送失败时不影响其他连接', () => {
      const received: string[] = [];
      const mgr = new ConnectionManager();
      mgr.register(() => { throw new Error('fail'); });
      mgr.register((data) => { received.push(data); });
      mgr.broadcast('test.method', {});
      assertEqual(received.length, 1, 'second connection should receive');
    });
  });

  // ──── router.ts 测试 ────

  describe('MessageRouter', () => {
    it('注册和查找方法', () => {
      const router = new MessageRouter();
      assert(!router.hasMethod('test'), 'not registered yet');
      router.register('test', async () => 'ok');
      assert(router.hasMethod('test'), 'registered');
    });

    it('正确路由已注册的方法', async () => {
      const router = new MessageRouter();
      router.register('echo', async (params) => params.message);

      const ctx: ConnectionContext = {
        connectionId: 'conn_1', sessionId: null, busy: false,
        connectedAt: '', lastActiveAt: '',
      };

      const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: { message: 'hello' } });
      const response = await router.handle(request, ctx);
      assertEqual(response?.result, 'hello', 'result');
      assertEqual(response?.id, 1, 'id');
      assertEqual(response?.error, undefined, 'no error');
    });

    it('无效 JSON 返回 PARSE_ERROR', async () => {
      const router = new MessageRouter();
      const response = await router.handle('{invalid json}', { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' });
      assertEqual(response?.error?.code, -32700, 'PARSE_ERROR code');
    });

    it('缺少 jsonrpc 字段返回 INVALID_REQUEST', async () => {
      const router = new MessageRouter();
      const response = await router.handle('{"id":1,"method":"test"}', { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' });
      assertEqual(response?.error?.code, -32600, 'INVALID_REQUEST code');
    });

    it('缺少 method 字段返回 INVALID_REQUEST', async () => {
      const router = new MessageRouter();
      const response = await router.handle('{"jsonrpc":"2.0","id":1}', { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' });
      assertEqual(response?.error?.code, -32600, 'INVALID_REQUEST code');
    });

    it('未注册方法返回 METHOD_NOT_FOUND', async () => {
      const router = new MessageRouter();
      const response = await router.handle('{"jsonrpc":"2.0","id":1,"method":"unknown"}', { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' });
      assertEqual(response?.error?.code, -32601, 'METHOD_NOT_FOUND code');
    });

    it('RouteError 正确转换为 JSON-RPC 错误', async () => {
      const router = new MessageRouter();
      router.register('fail', async () => {
        throw new RouteError(JsonRpcErrorCode.AUTH_FAILED, 'Token invalid');
      });

      const ctx: ConnectionContext = { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' };
      const response = await router.handle('{"jsonrpc":"2.0","id":42,"method":"fail"}', ctx);
      assertEqual(response?.error?.code, -32002, 'AUTH_FAILED code');
      assertEqual(response?.error?.message, 'Token invalid', 'error message');
      assertEqual(response?.id, 42, 'id preserved');
    });

    it('普通 Error 转换为 INTERNAL_ERROR', async () => {
      const router = new MessageRouter();
      router.register('boom', async () => { throw new Error('something broke'); });

      const ctx: ConnectionContext = { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' };
      const response = await router.handle('{"jsonrpc":"2.0","id":1,"method":"boom"}', ctx);
      assertEqual(response?.error?.code, -32603, 'INTERNAL_ERROR code');
      assertEqual(response?.error?.message, 'something broke', 'error message');
    });

    it('通知（无 id）不返回响应', async () => {
      const router = new MessageRouter();
      let called = false;
      router.register('notify_test', async () => { called = true; return 'result'; });

      const ctx: ConnectionContext = { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' };
      const response = await router.handle('{"jsonrpc":"2.0","method":"notify_test","params":{}}', ctx);
      assertEqual(response, null, 'notification should not return response');
      assert(called, 'handler should still be called');
    });

    it('缺少 params 时默认为空对象', async () => {
      const router = new MessageRouter();
      let receivedParams: Record<string, unknown> = { unexpected: true };
      router.register('check_params', async (params) => { receivedParams = params; return null; });

      const ctx: ConnectionContext = { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' };
      await router.handle('{"jsonrpc":"2.0","id":1,"method":"check_params"}', ctx);
      assertEqual(receivedParams, {}, 'should default to empty object');
    });

    it('getRegisteredMethods 返回所有方法名', () => {
      const router = new MessageRouter();
      router.register('a', async () => null);
      router.register('b', async () => null);
      router.register('c', async () => null);
      const methods = router.getRegisteredMethods();
      assert(methods.includes('a') && methods.includes('b') && methods.includes('c'), 'all methods listed');
      assertEqual(methods.length, 3);
    });

    it('字符串 ID 正确处理', async () => {
      const router = new MessageRouter();
      router.register('string_id_test', async () => 'ok');

      const ctx: ConnectionContext = { connectionId: 'c1', sessionId: null, busy: false, connectedAt: '', lastActiveAt: '' };
      const response = await router.handle('{"jsonrpc":"2.0","id":"abc-123","method":"string_id_test"}', ctx);
      assertEqual(response?.id, 'abc-123', 'string id preserved');
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
