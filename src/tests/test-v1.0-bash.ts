/**
 * src/tests/test-bash.ts
 *
 * 测试目标：验证 bash 工具独立运行是否正确
 * 阶段：Phase 1 (v1.0.0) — 最小可用 ReAct 循环
 * 依赖：无（不需要 API Key，不需要网络）
 * v1.0: 初始实现
 * v1.1: 适配 ToolContext 接口
 */

import { bashTool } from '../tools/bash.js';
import type { ToolContext } from '../tools/context.js';

const ctx: ToolContext = { workDir: process.cwd() };

async function testBash() {
  console.log('=== Test 1: bash tool (independent) ===\n');

  // Test 1a: 简单命令
  console.log('[1a] Execute: echo hello');
  const result1 = await bashTool.execute({ command: 'echo hello' }, ctx);
  console.log(`   Result: "${result1.content.trim()}"`);
  console.log(`   isError: ${result1.isError}`);
  console.assert(result1.content.includes('hello'), 'FAIL: should contain "hello"');
  console.assert(!result1.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 1b: 不存在的命令
  console.log('[1b] Execute: nonexistent_command_xyz');
  const result2 = await bashTool.execute({ command: 'nonexistent_command_xyz' }, ctx);
  console.log(`   isError: ${result2.isError}`);
  console.assert(result2.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 1c: 无参数
  console.log('[1c] Execute with missing param');
  const result3 = await bashTool.execute({ command: '' }, ctx);
  console.log(`   isError: ${result3.isError}`);
  console.assert(result3.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 1d: workDir 生效（验证 cwd 被正确设置）
  console.log('[1d] Verify workDir (cwd) is used');
  const result4 = await bashTool.execute({ command: 'cd' }, ctx);
  const normalizedPath = result4.content.trim().replace(/\\/g, '/');
  const expectedPath = ctx.workDir.replace(/\\/g, '/');
  console.log(`   cwd: ${result4.content.trim()}`);
  console.log(`   expected: ${ctx.workDir}`);
  console.assert(normalizedPath === expectedPath || result4.content.trim() === ctx.workDir, 'FAIL: cwd should match workDir');
  console.log('   PASS\n');

  console.log('=== All bash tool tests passed! ===');
}

testBash().catch(console.error);
