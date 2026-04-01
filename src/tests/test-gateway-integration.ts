/**
 * src/tests/test-gateway-integration.ts
 *
 * Gateway 集成测试 —— 覆盖 v6.0 新增 / 修复的功能。
 *
 * 测试覆盖：
 * - Bug 修复验证：
 *   1. HTTP 请求带查询参数时正确返回 Web UI（非 404）
 *   2. AuthGuard 从相对路径 URL 提取 token（WebSocket request.url）
 * - Gateway 模块单元测试：
 *   3. AuthGuard：token 生成、认证、时序安全
 *   4. ConnectionManager：注册/注销/广播/连接数限制
 *   5. MessageRouter：JSON-RPC 路由/错误码/通知处理
 * - 集成测试：
 *   6. GatewayServer 完整生命周期（start/stop/status）
 *   7. WebSocket 连接 + JSON-RPC 通信
 *   8. Web UI HTML 内容验证
 */

import { AuthGuard } from '../gateway/auth.js';
import { ConnectionManager } from '../gateway/connection.js';
import { MessageRouter } from '../gateway/router.js';
import { GatewayServer } from '../gateway/server.js';
import { JsonRpcErrorCode, RouteError, EVENT_TO_NOTIFICATION_METHOD } from '../gateway/types.js';
import type { ConnectionContext } from '../gateway/types.js';
import { getWebUIHTML } from '../gateway/web-ui.js';
import WebSocket from 'ws';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import http from 'node:http';

// ═══════════════════════════════════════════════════════════════
// 测试框架（内联，零依赖）
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
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
// 1. Bug 修复验证：AuthGuard 相对路径 URL
// ═══════════════════════════════════════════════════════════════

async function testAuthRelativeUrl(): Promise<void> {
  console.error('Bug Fix: AuthGuard relative URL token extraction');
  console.error('================================================');

  describe('extractFromUrl 回退', () => {
    it('从相对路径 /?token=xxx 提取 token', () => {
      const auth = new AuthGuard('my-secret-token');
      // WebSocket 的 request.url 是相对路径
      assert(auth.authenticate('/?token=my-secret-token', {}), 'should pass with relative URL');
    });

    it('从带 URL 编码的相对路径提取 token', () => {
      const auth = new AuthGuard('fc_abc123');
      assert(auth.authenticate('/?token=fc_abc123', {}), 'should pass with simple token');
    });

    it('相对路径错误 token 认证失败', () => {
      const auth = new AuthGuard('correct-token');
      assert(!auth.authenticate('/?token=wrong-token', {}), 'should fail with wrong token');
    });

    it('完整 URL 仍然有效', () => {
      const auth = new AuthGuard('test123');
      assert(auth.authenticate('ws://localhost:3000/?token=test123', {}), 'should pass with full URL');
    });

    it('从 & 分隔的查询参数提取 token', () => {
      const auth = new AuthGuard('mytoken');
      assert(auth.authenticate('/?foo=bar&token=mytoken&baz=qux', {}), 'should pass with mixed params');
    });

    it('无 token 参数的相对路径认证失败', () => {
      const auth = new AuthGuard('secret');
      assert(!auth.authenticate('/', {}), 'should fail without token param');
      assert(!auth.authenticate('/path', {}), 'should fail without token param');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 2. Bug 修复验证：HTTP 请求带查询参数
// ═══════════════════════════════════════════════════════════════

async function testHttpRequestWithQueryParams(): Promise<void> {
  console.error('Bug Fix: HTTP request with query params');
  console.error('=========================================');

  describe('Gateway HTTP 处理', () => {
    it('GET /?token=xxx 返回 Web UI HTML（非 404）', async () => {
      // 创建 mock LLMClient 和 ToolRegistry
      const mockLLM = {
        chat: async () => ({ content: 'test', role: 'assistant' }),
      } as unknown as LLMClient;
      const mockTools = {} as unknown as ToolRegistry;

      // 找一个空闲端口
      const port = await findFreePort();
      const gateway = new GatewayServer({ port, authToken: 'test-token' });
      gateway.setLLM(mockLLM);
      gateway.setTools(mockTools);

      try {
        await gateway.start();

        // 测试 1: GET / （不带参数）
        const res1 = await httpGet(`http://127.0.0.1:${port}/`);
        assertEqual(res1.statusCode, 200, '/ status code');
        assert(res1.body.includes('<!DOCTYPE html>'), '/ should return HTML');
        assert(res1.body.includes('FirmClaw'), '/ should contain FirmClaw');

        // 测试 2: GET /?token=xxx （带查询参数 —— 这是 bug 修复的核心）
        const res2 = await httpGet(`http://127.0.0.1:${port}/?token=test-token`);
        assertEqual(res2.statusCode, 200, '/?token= status code');
        assert(res2.body.includes('<!DOCTYPE html>'), '/?token= should return HTML');

        // 测试 3: GET /index.html?token=xxx
        const res3 = await httpGet(`http://127.0.0.1:${port}/index.html?token=test-token`);
        assertEqual(res3.statusCode, 200, '/index.html?token= status code');
        assert(res3.body.includes('<!DOCTYPE html>'), '/index.html?token= should return HTML');

        // 测试 4: GET /other-path 返回 404
        const res4 = await httpGet(`http://127.0.0.1:${port}/api`);
        assertEqual(res4.statusCode, 404, '/api status code');

      } finally {
        await gateway.stop();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 3. AuthGuard 完整测试
// ═══════════════════════ 认════════════════════════════════════

async function testAuthGuardFull(): Promise<void> {
  console.error('AuthGuard');
  console.error('=========');

  describe('token 生成', () => {
    it('generateToken 返回 fc_ 前缀', () => {
      const token = AuthGuard.generateToken();
      assert(token.startsWith('fc_'), 'should start with fc_');
      assert(token.length > 10, 'should be long enough');
    });

    it('每次生成不同 token', () => {
      const t1 = AuthGuard.generateToken();
      const t2 = AuthGuard.generateToken();
      assert(t1 !== t2, 'tokens should be unique');
    });
  });

  describe('认证逻辑', () => {
    it('无 token 配置跳过认证', () => {
      const auth = new AuthGuard();
      assert(!auth.isEnabled(), 'should be disabled');
      assert(auth.authenticate('/?anything=xxx', {}), 'should pass');
    });

    it('URL 参数认证通过', () => {
      const auth = new AuthGuard('secret123');
      assert(auth.authenticate('/?token=secret123', {}), 'relative URL');
      assert(auth.authenticate('ws://localhost:3000/?token=secret123', {}), 'full URL');
    });

    it('Header 认证通过', () => {
      const auth = new AuthGuard('secret123');
      assert(auth.authenticate('ws://localhost:3000/', { 'sec-websocket-protocol': 'secret123' }), 'header');
    });

    it('URL 参数优先于 Header', () => {
      const auth = new AuthGuard('secret123');
      assert(
        auth.authenticate('/?token=secret123', { 'sec-websocket-protocol': 'wrong' }),
        'URL should take priority'
      );
    });

    it('getToken / isEnabled', () => {
      assertEqual(new AuthGuard('x').getToken(), 'x');
      assertEqual(new AuthGuard().getToken(), null);
      assert(new AuthGuard('x').isEnabled());
      assert(!new AuthGuard().isEnabled());
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. ConnectionManager 测试
// ═══════════════════════════════════════════════════════════════

async function testConnectionManager(): Promise<void> {
  console.error('ConnectionManager');
  console.error('=================');

  describe('连接生命周期', () => {
    it('注册连接返回有效上下文', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      assert(ctx.connectionId.startsWith('conn_'), 'id format');
      assertEqual(ctx.sessionId, null);
      assert(!ctx.busy);
      assertEqual(mgr.count(), 1);
    });

    it('ID 递增', () => {
      const mgr = new ConnectionManager();
      const c1 = mgr.register(() => {});
      const c2 = mgr.register(() => {});
      assert(c1.connectionId !== c2.connectionId);
    });

    it('注销后连接数减少', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      assertEqual(mgr.count(), 1);
      mgr.unregister(ctx.connectionId);
      assertEqual(mgr.count(), 0);
    });

    it('最大连接数限制', () => {
      const mgr = new ConnectionManager(2);
      mgr.register(() => {});
      mgr.register(() => {});
      assertThrows(() => mgr.register(() => {}), 'should throw on max');
    });

    it('bindSession / setBusy / touch', () => {
      const mgr = new ConnectionManager();
      const ctx = mgr.register(() => {});
      mgr.bindSession(ctx.connectionId, 'sess-1');
      assertEqual(mgr.get(ctx.connectionId)?.sessionId, 'sess-1');

      mgr.setBusy(ctx.connectionId, true);
      assert(mgr.get(ctx.connectionId)?.busy);
      mgr.setBusy(ctx.connectionId, false);
      assert(!mgr.get(ctx.connectionId)?.busy);

      mgr.touch(ctx.connectionId);
      assert(mgr.get(ctx.connectionId)?.lastActiveAt !== undefined);
    });

    it('sendTo / broadcast', () => {
      const received: string[] = [];
      const mgr = new ConnectionManager();
      mgr.register((data) => received.push(data));
      mgr.register((data) => received.push(data));

      const ctx = mgr.register(() => {});
      assert(mgr.sendTo(ctx.connectionId, 'hello'));
      assert(!mgr.sendTo('nonexistent', 'hello'));

      received.length = 0;
      mgr.broadcast('test.method', { key: 'val' });
      assertEqual(received.length, 2);
      const expected = JSON.stringify({ jsonrpc: '2.0', method: 'test.method', params: { key: 'val' } });
      assertEqual(received[0], expected);
    });

    it('unregisterAll', () => {
      const mgr = new ConnectionManager();
      mgr.register(() => {});
      mgr.register(() => {});
      mgr.unregisterAll();
      assertEqual(mgr.count(), 0);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. MessageRouter 测试
// ═══════════════════════════════════════════════════════════════

async function testMessageRouter(): Promise<void> {
  console.error('MessageRouter');
  console.error('=============');

  const defaultCtx: ConnectionContext = {
    connectionId: 'test-conn-1',
    sessionId: null,
    busy: false,
    connectedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };

  describe('JSON-RPC 路由', () => {
    it('正确路由已注册方法', async () => {
      const router = new MessageRouter();
      router.register('echo', async (params) => params.message);
      const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: { message: 'hello' } });
      const resp = await router.handle(raw, defaultCtx);
      assertEqual(resp?.result, 'hello');
      assertEqual(resp?.id, 1);
    });

    it('无效 JSON → PARSE_ERROR', async () => {
      const router = new MessageRouter();
      const resp = await router.handle('{invalid}', defaultCtx);
      assertEqual(resp?.error?.code, -32700);
    });

    it('方法未找到 → METHOD_NOT_FOUND', async () => {
      const router = new MessageRouter();
      const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nonexistent' });
      const resp = await router.handle(raw, defaultCtx);
      assertEqual(resp?.error?.code, -32601);
    });

    it('RouteError → JSON-RPC 错误响应', async () => {
      const router = new MessageRouter();
      router.register('fail', async () => {
        throw new RouteError(JsonRpcErrorCode.AUTH_FAILED, 'Token invalid');
      });
      const raw = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'fail' });
      const resp = await router.handle(raw, defaultCtx);
      assertEqual(resp?.error?.code, -32002);
      assertEqual(resp?.error?.message, 'Token invalid');
    });

    it('通知无响应', async () => {
      const router = new MessageRouter();
      let called = false;
      router.register('notify', async () => { called = true; return 'ok'; });
      const raw = JSON.stringify({ jsonrpc: '2.0', method: 'notify', params: {} });
      const resp = await router.handle(raw, defaultCtx);
      assertEqual(resp, null);
      assert(called, 'handler should be called');
    });

    it('缺少 params 默认为空对象', async () => {
      const router = new MessageRouter();
      let received: Record<string, unknown> = { unexpected: true };
      router.register('check', async (params) => { received = params; return null; });
      await router.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'check' }), defaultCtx);
      assertEqual(received, {});
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. GatewayServer 集成测试
// ═══════════════════════════════════════════════════════════════

async function testGatewayServerIntegration(): Promise<void> {
  console.error('GatewayServer Integration');
  console.error('=========================');

  describe('服务器生命周期', () => {
    it('start → getStatus → stop', async () => {
      const mockLLM = { chat: async () => ({ content: '', role: 'assistant' }) } as unknown as LLMClient;
      const mockTools = {} as unknown as ToolRegistry;
      const port = await findFreePort();
      const gateway = new GatewayServer({ port, authToken: 'test-tok' });
      gateway.setLLM(mockLLM);
      gateway.setTools(mockTools);

      const status1 = gateway.getStatus();
      assert(!status1.running, 'should not be running before start');

      await gateway.start();
      const status2 = gateway.getStatus();
      assert(status2.running, 'should be running after start');
      assertEqual(status2.port, port);
      assertEqual(status2.connections, 0);

      await sleep(100);
      assert(status2.uptime > 0, 'uptime should be positive');

      await gateway.stop();
      const status3 = gateway.getStatus();
      assert(!status3.running, 'should not be running after stop');
    });

    it('start() 缺少 LLMClient 抛异常', async () => {
      const gateway = new GatewayServer({ port: 19999 });
      try {
        await gateway.start();
        throw new Error('should have thrown');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        assert(msg.includes('LLMClient'), 'should mention LLMClient');
      }
    });
  });

  describe('WebSocket 连接 + JSON-RPC', () => {
    it('无 token 连接被拒绝', async () => {
      const mockLLM = { chat: async () => ({ content: '', role: 'assistant' }) } as unknown as LLMClient;
      const mockTools = {} as unknown as ToolRegistry;
      const port = await findFreePort();
      const gateway = new GatewayServer({ port, authToken: 'secret' });
      gateway.setLLM(mockLLM);
      gateway.setTools(mockTools);
      await gateway.start();

      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
        const [code] = await new Promise<[number]>((resolve) => {
          ws.on('close', (code) => resolve([code]));
          ws.on('error', () => {}); // suppress
        });
        assertEqual(code, 4001, 'should close with 4001 auth failed');
      } finally {
        await gateway.stop();
      }
    });

    it('正确 token 连接成功 + gateway.status 调用', async () => {
      const mockLLM = { chat: async () => ({ content: '', role: 'assistant' }) } as unknown as LLMClient;
      const mockTools = {} as unknown as ToolRegistry;
      const port = await findFreePort();
      const token = 'test-integration-token';
      const gateway = new GatewayServer({ port, authToken: token });
      gateway.setLLM(mockLLM);
      gateway.setTools(mockTools);
      gateway.setAgentConfig({ systemPrompt: '', maxTurns: 1, workDir: '/tmp' });
      await gateway.start();

      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
        const open = await new Promise<boolean>((resolve) => {
          ws.on('open', () => resolve(true));
          ws.on('error', () => resolve(false));
        });
        assert(open, 'should connect successfully');

        // 发送 gateway.status 请求
        const reqId = 1;
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: reqId,
          method: 'gateway.status',
          params: {},
        }));

        const response = await new Promise<string>((resolve) => {
          ws.on('message', (data) => resolve(data.toString()));
        });

        const parsed = JSON.parse(response);
        assertEqual(parsed.jsonrpc, '2.0');
        assertEqual(parsed.id, reqId);
        assert(parsed.result.running, 'result.running should be true');
        assertEqual(parsed.result.port, port);
        assert(typeof parsed.result.connections === 'number', 'connections should be number');

        ws.close();
      } finally {
        await gateway.stop();
      }
    });

    it('未注册方法返回 METHOD_NOT_FOUND', async () => {
      const mockLLM = { chat: async () => ({ content: '', role: 'assistant' }) } as unknown as LLMClient;
      const mockTools = {} as unknown as ToolRegistry;
      const port = await findFreePort();
      const gateway = new GatewayServer({ port, authToken: 'tok' });
      gateway.setLLM(mockLLM);
      gateway.setTools(mockTools);
      gateway.setAgentConfig({ systemPrompt: '', maxTurns: 1, workDir: '/tmp' });
      await gateway.start();

      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=tok`);
        await new Promise<void>((resolve) => {
          ws.on('open', () => resolve());
        });

        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'nonexistent.method', params: {} }));

        const response = await new Promise<string>((resolve) => {
          ws.on('message', (data) => resolve(data.toString()));
        });
        const parsed = JSON.parse(response);
        assertEqual(parsed.error.code, -32601, 'should be METHOD_NOT_FOUND');

        ws.close();
      } finally {
        await gateway.stop();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 7. Web UI HTML 验证
// ═══════════════════════════════════════════════════════════════

async function testWebUIHTML(): Promise<void> {
  console.error('Web UI HTML');
  console.error('=============');

  describe('Web UI 内容', () => {
    it('HTML 包含关键元素', () => {
      const html = getWebUIHTML();
      assert(html.includes('<!DOCTYPE html>'), 'DOCTYPE');
      assert(html.includes('FirmClaw'), 'title text');
      assert(html.includes('agent.chat'), 'agent.chat method');
      assert(html.includes('session.new'), 'session.new method');
      assert(html.includes('session.resume'), 'session.resume method');
      assert(html.includes('session.list'), 'session.list method');
      assert(html.includes('agent.thinking'), 'agent.thinking notification');
      assert(html.includes('agent.tool_start'), 'agent.tool_start notification');
      assert(html.includes('agent.message_end'), 'agent.message_end notification');
      assert(html.includes('agent.error'), 'agent.error notification');
      assert(html.includes('handleMessage'), 'handleMessage function');
    });

    it('不包含旧的方法名', () => {
      const html = getWebUIHTML();
      assert(!html.includes('chat.send'), 'should not have chat.send');
      assert(!html.includes('session.create'), 'should not have session.create');
      assert(!html.includes('session.switch'), 'should not have session.switch');
      assert(!html.includes("'notification'"), 'should not have old notification wrapper');
    });

    it('包含响应处理逻辑', () => {
      const html = getWebUIHTML();
      assert(html.includes('pendingRequests'), 'should track pending requests');
      assert(html.includes('msg.id !== undefined'), 'should check for response');
      assert(html.includes('msg.result'), 'should handle result');
      assert(html.includes('msg.error'), 'should handle error');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        server.close(() => resolve(addr.port));
      } else {
        reject(new Error('Failed to get port'));
      }
    });
    server.on('error', reject);
  });
}

function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// 运行
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.error('Gateway Integration Tests (v6.0 bug fixes + features)');
  console.error('======================================================\n');

  await testAuthRelativeUrl();
  await testAuthGuardFull();
  await testConnectionManager();
  await testMessageRouter();
  await testWebUIHTML();
  await testHttpRequestWithQueryParams();
  await testGatewayServerIntegration();

  await runTestQueue();

  console.error(`\n${'='.repeat(50)}`);
  console.error(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
