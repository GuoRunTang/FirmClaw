/**
 * src/tests/test-read.ts
 *
 * 测试目标：验证 read_file 工具
 * 阶段：Phase 2 (v1.2.0) — 文件读取工具
 * 依赖：无（不需要 API Key，不需要网络）
 * 测试内容：普通读取、offset/limit 分段、二进制检测、相对路径解析
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readTool } from '../tools/read.js';
import type { ToolContext } from '../tools/context.js';

const ctx: ToolContext = { workDir: process.cwd() };

/** 创建临时目录，返回路径 */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'firmclaw-test-'));
}

async function testRead() {
  console.log('=== Test: read_file tool ===\n');

  const tmp = tmpDir();

  // Test 1: 读取普通文本文件
  console.log('[1] Read a normal text file');
  const testFile = path.join(tmp, 'hello.txt');
  fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4\nline5\n', 'utf-8');
  const r1 = await readTool.execute({ path: testFile }, ctx);
  console.log(`   Lines: ${r1.content.split('\n').length}`);
  console.assert(r1.content.includes('line1'), 'FAIL: should contain line1');
  console.assert(r1.content.includes('line5'), 'FAIL: should contain line5');
  console.assert(r1.content.includes('     1:line1'), 'FAIL: should have line numbers');
  console.assert(!r1.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 2: offset/limit 分段读取
  console.log('[2] Read with offset=2, limit=2');
  const r2 = await readTool.execute({ path: testFile, offset: 2, limit: 2 }, ctx);
  console.log(`   Result:\n${r2.content}`);
  console.assert(r2.content.includes('line2'), 'FAIL: should contain line2');
  console.assert(r2.content.includes('line3'), 'FAIL: should contain line3');
  console.assert(!r2.content.includes('line1'), 'FAIL: should NOT contain line1');
  console.assert(!r2.content.includes('line4'), 'FAIL: should NOT contain line4');
  console.assert(!r2.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 3: 不存在的文件
  console.log('[3] Read non-existent file');
  const r3 = await readTool.execute({ path: path.join(tmp, 'nonexistent.txt') }, ctx);
  console.log(`   isError: ${r3.isError}`);
  console.assert(r3.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 4: 二进制文件检测
  console.log('[4] Reject binary file');
  const binFile = path.join(tmp, 'binary.bin');
  const binData = Buffer.from([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x57, 0x6F, 0x72, 0x6C, 0x64]); // "Hello\0World"
  fs.writeFileSync(binFile, binData);
  const r4 = await readTool.execute({ path: binFile }, ctx);
  console.log(`   isError: ${r4.isError}`);
  console.assert(r4.isError === true, 'FAIL: should reject binary');
  console.assert(r4.content.includes('Binary file'), 'FAIL: should mention binary');
  console.log('   PASS\n');

  // Test 5: 相对路径解析（基于 workDir）
  console.log('[5] Read with relative path');
  const r5 = await readTool.execute({ path: 'package.json' }, ctx);
  console.log(`   Has content: ${r5.content.length > 0}`);
  console.assert(r5.content.includes('"name"'), 'FAIL: should find "name" in package.json');
  console.assert(!r5.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 6: offset 超出文件行数
  console.log('[6] Offset exceeds file length');
  const r6 = await readTool.execute({ path: testFile, offset: 100 }, ctx);
  console.log(`   isError: ${r6.isError}`);
  console.assert(r6.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // 清理
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('=== All read_file tests passed! ===');
}

testRead().catch(console.error);
