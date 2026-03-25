/**
 * src/tests/test-bash.ts
 *
 * 测试目标：验证 bash 工具独立运行是否正确
 * - 不需要 API Key，不需要网络
 * - 验证命令执行、成功输出、错误处理
 */

import { bashTool } from '../tools/bash.js';

async function testBash() {
  console.log('=== Test 1: bash tool (independent) ===\n');

  // Test 1a: 简单命令
  console.log('[1a] Execute: echo hello');
  const result1 = await bashTool.execute({ command: 'echo hello' });
  console.log(`   Result: "${result1.content.trim()}"`);
  console.log(`   isError: ${result1.isError}`);
  console.assert(result1.content.includes('hello'), 'FAIL: should contain "hello"');
  console.assert(!result1.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 1b: 不存在的命令
  console.log('[1b] Execute: nonexistent_command_xyz');
  const result2 = await bashTool.execute({ command: 'nonexistent_command_xyz' });
  console.log(`   isError: ${result2.isError}`);
  console.assert(result2.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 1c: 无参数
  console.log('[1c] Execute with missing param');
  const result3 = await bashTool.execute({});
  console.log(`   isError: ${result3.isError}`);
  console.assert(result3.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  console.log('=== All bash tool tests passed! ===');
}

testBash().catch(console.error);
