/**
 * src/tests/test-write.ts
 *
 * 测试目标：验证 write_file 工具
 * 阶段：Phase 2 (v1.3.0) — 文件写入工具
 * 依赖：无（不需要 API Key，不需要网络）
 * 测试内容：创建文件、覆写、自动创建目录、边界情况、交互测试
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeTool } from '../tools/write.js';
import { readTool } from '../tools/read.js';
import type { ToolContext } from '../tools/context.js';

const ctx: ToolContext = { workDir: process.cwd() };

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'firmclaw-test-'));
}

async function testWrite() {
  console.log('=== Test: write_file tool ===\n');

  const tmp = tmpDir();
  const tmpCtx: ToolContext = { workDir: tmp };

  // Test 1: 创建新文件
  console.log('[1] Create a new file');
  const file1 = path.join(tmp, 'test.txt');
  const w1 = await writeTool.execute({ path: file1, content: 'Hello, FirmClaw!' }, tmpCtx);
  console.log(`   ${w1.content}`);
  console.assert(!w1.isError, 'FAIL: should not be error');
  console.assert(fs.existsSync(file1), 'FAIL: file should exist');
  const read1 = fs.readFileSync(file1, 'utf-8');
  console.assert(read1 === 'Hello, FirmClaw!', 'FAIL: content mismatch');
  console.log('   PASS\n');

  // Test 2: 覆写已有文件
  console.log('[2] Overwrite existing file');
  const w2 = await writeTool.execute({ path: file1, content: 'Updated content' }, tmpCtx);
  console.log(`   ${w2.content}`);
  console.assert(!w2.isError, 'FAIL: should not be error');
  const read2 = fs.readFileSync(file1, 'utf-8');
  console.assert(read2 === 'Updated content', 'FAIL: should be updated');
  console.log('   PASS\n');

  // Test 3: 自动创建多层目录
  console.log('[3] Auto-create nested directories');
  const nested = path.join(tmp, 'a', 'b', 'c', 'deep.txt');
  const w3 = await writeTool.execute({ path: nested, content: 'nested content' }, tmpCtx);
  console.log(`   ${w3.content}`);
  console.assert(!w3.isError, 'FAIL: should not be error');
  console.assert(fs.existsSync(nested), 'FAIL: nested file should exist');
  console.log('   PASS\n');

  // Test 4: createDirs=false 时父目录不存在 → 报错
  console.log('[4] createDirs=false with missing parent');
  const orphan = path.join(tmp, 'nonexistent-dir', 'file.txt');
  const w4 = await writeTool.execute({ path: orphan, content: 'test', createDirs: false }, tmpCtx);
  console.log(`   isError: ${w4.isError}`);
  console.assert(w4.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 5: 路径指向目录 → 拒绝
  console.log('[5] Reject writing to a directory');
  const w5 = await writeTool.execute({ path: tmp, content: 'should fail' }, tmpCtx);
  console.log(`   isError: ${w5.isError}`);
  console.assert(w5.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 6: 相对路径解析（基于 workDir）
  console.log('[6] Write with relative path');
  const w6 = await writeTool.execute({ path: 'rel-test.txt', content: 'relative path content' }, tmpCtx);
  console.log(`   ${w6.content}`);
  console.assert(!w6.isError, 'FAIL: should not be error');
  console.assert(fs.existsSync(path.join(tmp, 'rel-test.txt')), 'FAIL: file should exist in workDir');
  console.log('   PASS\n');

  // Test 7: 写入后用 read 验证（交互测试）
  console.log('[7] Write then read (interaction test)');
  const testFile = path.join(tmp, 'roundtrip.txt');
  const original = 'line1\nline2\nline3';
  await writeTool.execute({ path: testFile, content: original }, tmpCtx);
  const r7 = await readTool.execute({ path: testFile }, tmpCtx);
  console.assert(r7.content.includes('line1'), 'FAIL: read should contain line1');
  console.assert(r7.content.includes('line3'), 'FAIL: read should contain line3');
  console.log('   PASS\n');

  // Test 8: 写入空内容
  console.log('[8] Write empty content');
  const empty = path.join(tmp, 'empty.txt');
  const w8 = await writeTool.execute({ path: empty, content: '' }, tmpCtx);
  console.log(`   ${w8.content}`);
  console.assert(!w8.isError, 'FAIL: should not be error');
  console.assert(fs.readFileSync(empty, 'utf-8') === '', 'FAIL: should be empty');
  console.log('   PASS\n');

  // 清理
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('=== All write_file tests passed! ===');
}

testWrite().catch(console.error);
