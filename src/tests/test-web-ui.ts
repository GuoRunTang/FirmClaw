/**
 * src/tests/test-web-ui.ts
 *
 * v5.4 Web UI 单元测试
 *
 * 覆盖范围：
 * - getWebUIHTML(): HTML 完整性、必需元素
 * - GatewayServer: HTTP GET 返回正确内容
 */

import { getWebUIHTML } from '../gateway/web-ui.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架
// ═══════════════════════════════════════════════════════════════

const testQueue: Array<{ name: string; fn: () => Promise<void> }> = [];

function describe(name: string, fn: () => void): void {
  console.error(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => Promise<void> | void): void {
  testQueue.push({ name, fn: fn as () => Promise<void> });
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function assertIncludes(haystack: string, needle: string, label?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Assertion failed: "${label ?? needle}" not found`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.error('Web UI Tests (v5.4)');
  console.error('====================');

  describe('getWebUIHTML', () => {
    it('返回非空 HTML 字符串', () => {
      const html = getWebUIHTML();
      assert(html.length > 0, 'HTML 不应为空');
      assertIncludes(html, '<!DOCTYPE html>', '应有 DOCTYPE');
      assertIncludes(html, '</html>', '应有闭合 html 标签');
    });

    it('包含 WebSocket 连接逻辑', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'WebSocket', '应包含 WebSocket 关键字');
      assertIncludes(html, 'wss:', '应包含 wss: 协议');
      assertIncludes(html, 'token', '应包含 token 参数');
    });

    it('包含 JSON-RPC 2.0 协议', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'jsonrpc', '应包含 jsonrpc');
      assertIncludes(html, '2.0', '应包含 2.0 版本');
    });

    it('包含消息输入区域', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'textarea', '应有输入框');
      assertIncludes(html, 'send', '应有发送功能');
      assertIncludes(html, 'Enter', '应支持 Enter 发送');
    });

    it('包含会话管理功能', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'session', '应包含 session');
      assertIncludes(html, 'newSession', '应有新建会话功能');
    });

    it('包含事件通知处理', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'thinking', '应有 thinking 处理');
      assertIncludes(html, 'tool_start', '应有 tool_start 处理');
      assertIncludes(html, 'tool_end', '应有 tool_end 处理');
      assertIncludes(html, 'message_end', '应有 message_end 处理');
    });

    it('包含状态指示器', () => {
      const html = getWebUIHTML();
      assertIncludes(html, 'Connected', '应有连接状态');
      assertIncludes(html, 'Disconnected', '应有断开状态');
    });

    it('HTML 是有效的（基本标签配对）', () => {
      const html = getWebUIHTML();
      const openTags = (html.match(/<div/g) || []).length;
      const closeTags = (html.match(/<\/div>/g) || []).length;
      assert(openTags === closeTags, `<div> 不匹配: open=${openTags}, close=${closeTags}`);

      const openStyles = (html.match(/<style/g) || []).length;
      const closeStyles = (html.match(/<\/style>/g) || []).length;
      assert(openStyles === closeStyles, `<style> 不匹配`);

      const openScripts = (html.match(/<script/g) || []).length;
      const closeScripts = (html.match(/<\/script>/g) || []).length;
      assert(openScripts === closeScripts, `<script> 不匹配`);
    });
  });

  // ──── 运行所有测试 ────
  await runTestQueue();
}

async function runTestQueue(): Promise<void> {
  let passed = 0;
  let failed = 0;

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

  console.error(`\n${'='.repeat(50)}`);
  console.error(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
