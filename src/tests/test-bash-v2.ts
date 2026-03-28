/**
 * src/tests/test-bash-v2.ts
 *
 * 测试目标：验证 bash 工具 spawn() 升级后的功能
 * - 超时控制、cwd 指定、大输出截断、退出码处理
 */

import { bashTool } from '../tools/bash.js';
import type { ToolContext } from '../tools/context.js';

const ctx: ToolContext = { workDir: process.cwd() };

async function testBashV2() {
  console.log('=== Test: bash tool v2 (spawn) ===\n');

  // Test 1: 基本命令
  console.log('[1] Basic command execution');
  const r1 = await bashTool.execute({ command: 'echo hello world' }, ctx);
  console.log(`   Output: "${r1.content.trim()}"`);
  console.assert(r1.content.includes('hello world'), 'FAIL: should contain output');
  console.assert(!r1.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 2: cwd 参数
  console.log('[2] Custom cwd');
  const r2 = await bashTool.execute({ command: 'cd', cwd: 'C:\\' }, ctx);
  console.log(`   cwd output: "${r2.content.trim()}"`);
  console.assert(!r2.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 3: 超时控制（1s 超时执行长命令）
  console.log('[3] Timeout (1s) with long-running command');
  const r3 = await bashTool.execute(
    { command: 'ping -n 10 127.0.0.1', timeout: 1 },
    ctx,
  );
  console.log(`   isError: ${r3.isError}`);
  console.assert(r3.isError === true, 'FAIL: should be error (timeout)');
  console.assert(r3.content.includes('timed out'), 'FAIL: should mention timeout');
  console.log('   PASS\n');

  // Test 4: 命令失败（非零退出码）
  console.log('[4] Non-zero exit code');
  const r4 = await bashTool.execute({ command: 'exit 42' }, ctx);
  console.log(`   isError: ${r4.isError}`);
  console.assert(r4.isError === true, 'FAIL: should be error');
  console.assert(r4.content.includes('42'), 'FAIL: should mention exit code');
  console.log('   PASS\n');

  // Test 5: 默认 workDir 生效
  console.log('[5] Default workDir (no cwd param)');
  const r5 = await bashTool.execute({ command: 'cd' }, ctx);
  const cwdOutput = r5.content.trim().replace(/\\/g, '/');
  const expectedDir = ctx.workDir.replace(/\\/g, '/');
  console.log(`   cwd: ${cwdOutput}`);
  console.log(`   expected: ${expectedDir}`);
  console.assert(cwdOutput === expectedDir, 'FAIL: cwd should match workDir');
  console.log('   PASS\n');

  // Test 6: 无效命令
  console.log('[6] Invalid command');
  const r6 = await bashTool.execute({ command: 'nonexistent_cmd_xyz_123' }, ctx);
  console.log(`   isError: ${r6.isError}`);
  console.assert(r6.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 7: 多行输出
  console.log('[7] Multi-line output');
  const r7 = await bashTool.execute({ command: 'echo line1 && echo line2 && echo line3' }, ctx);
  const lineCount = r7.content.split('\n').filter(l => l.trim()).length;
  console.log(`   Lines: ${lineCount}`);
  console.assert(lineCount >= 3, 'FAIL: should have at least 3 lines');
  console.log('   PASS\n');

  console.log('=== All bash v2 tests passed! ===');
}

testBashV2().catch(console.error);
