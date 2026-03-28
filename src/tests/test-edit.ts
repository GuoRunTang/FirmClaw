/**
 * src/tests/test-edit.ts
 *
 * 测试目标：验证 edit_file 工具
 * 阶段：Phase 2 (v1.4.0) — 文件编辑工具
 * 依赖：无（不需要 API Key，不需要网络）
 * 测试内容：正常替换、多次出现拒绝、不存在拒绝、多行替换、三工具交互
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { editTool } from '../tools/edit.js';
import { readTool } from '../tools/read.js';
import { writeTool } from '../tools/write.js';
import type { ToolContext } from '../tools/context.js';

const ctx: ToolContext = { workDir: process.cwd() };

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'firmclaw-test-'));
}

async function testEdit() {
  console.log('=== Test: edit_file tool ===\n');

  const tmp = tmpDir();
  const tmpCtx: ToolContext = { workDir: tmp };

  // 准备测试文件
  const testFile = path.join(tmp, 'code.ts');
  fs.writeFileSync(testFile, [
    'function hello() {',
    '  console.log("hello");',
    '  return true;',
    '}',
    '',
    'function goodbye() {',
    '  console.log("goodbye");',
    '  return false;',
    '}',
  ].join('\n'), 'utf-8');

  // Test 1: 正常替换
  console.log('[1] Normal find-and-replace');
  const e1 = await editTool.execute({
    path: testFile,
    old_str: 'console.log("hello");',
    new_str: 'console.log("Hello, FirmClaw!");',
  }, tmpCtx);
  console.log(`   ${e1.content}`);
  console.assert(!e1.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 2: old_str 出现多次 → 拒绝
  console.log('[2] Reject non-unique old_str');
  const e2 = await editTool.execute({
    path: testFile,
    old_str: 'console.log',
    new_str: 'logger.info',
  }, tmpCtx);
  console.log(`   isError: ${e2.isError}`);
  console.assert(e2.isError === true, 'FAIL: should reject non-unique');
  console.assert(e2.content.includes('2 times'), 'FAIL: should mention occurrence count');
  console.log('   PASS\n');

  // Test 3: old_str 不存在 → 拒绝
  console.log('[3] Reject non-existent old_str');
  const e3 = await editTool.execute({
    path: testFile,
    old_str: 'nonexistent_text_xyz',
    new_str: 'replacement',
  }, tmpCtx);
  console.log(`   isError: ${e3.isError}`);
  console.assert(e3.isError === true, 'FAIL: should reject non-existent');
  console.log('   PASS\n');

  // Test 4: 空 old_str → 拒绝
  console.log('[4] Reject empty old_str');
  const e4 = await editTool.execute({
    path: testFile,
    old_str: '',
    new_str: 'something',
  }, tmpCtx);
  console.log(`   isError: ${e4.isError}`);
  console.assert(e4.isError === true, 'FAIL: should reject empty old_str');
  console.log('   PASS\n');

  // Test 5: 替换后用 read 验证（交互测试）
  console.log('[5] Edit then read verification');
  const verify = await readTool.execute({ path: testFile }, tmpCtx);
  console.assert(verify.content.includes('Hello, FirmClaw!'), 'FAIL: should contain replacement');
  console.assert(!verify.content.includes('console.log("hello");'), 'FAIL: should not contain old text');
  console.log('   PASS\n');

  // Test 6: 多行替换
  console.log('[6] Multi-line replacement');
  const multiFile = path.join(tmp, 'multi.txt');
  fs.writeFileSync(multiFile, 'aaa\nbbb\nccc\nddd\n', 'utf-8');
  const e6 = await editTool.execute({
    path: multiFile,
    old_str: 'bbb\nccc',
    new_str: 'B\nC',
  }, tmpCtx);
  console.log(`   ${e6.content}`);
  console.assert(!e6.isError, 'FAIL: should not be error');
  const r6 = fs.readFileSync(multiFile, 'utf-8');
  console.assert(r6 === 'aaa\nB\nC\nddd\n', 'FAIL: multi-line replacement mismatch');
  console.log('   PASS\n');

  // Test 7: 文件不存在
  console.log('[7] File not found');
  const e7 = await editTool.execute({
    path: path.join(tmp, 'nonexistent.txt'),
    old_str: 'anything',
    new_str: 'anything else',
  }, tmpCtx);
  console.log(`   isError: ${e7.isError}`);
  console.assert(e7.isError === true, 'FAIL: should be error');
  console.log('   PASS\n');

  // Test 8: 相对路径（基于 workDir）
  console.log('[8] Relative path');
  fs.writeFileSync(path.join(tmp, 'rel-edit.txt'), 'old content\n', 'utf-8');
  const e8 = await editTool.execute({
    path: 'rel-edit.txt',
    old_str: 'old content',
    new_str: 'new content',
  }, tmpCtx);
  console.log(`   ${e8.content}`);
  console.assert(!e8.isError, 'FAIL: should not be error');
  console.log('   PASS\n');

  // Test 9: write → edit → read 完整流程（三工具交互）
  console.log('[9] Write → Edit → Read (full tool interaction)');
  const flowFile = path.join(tmp, 'flow.txt');
  await writeTool.execute({ path: flowFile, content: 'name: Alice\nage: 30\n' }, tmpCtx);
  await editTool.execute({ path: flowFile, old_str: 'Alice', new_str: 'Bob' }, tmpCtx);
  const r9 = await readTool.execute({ path: flowFile }, tmpCtx);
  console.assert(r9.content.includes('Bob'), 'FAIL: should contain Bob');
  console.assert(!r9.content.includes('Alice'), 'FAIL: should not contain Alice');
  console.log('   PASS\n');

  // 清理
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('=== All edit_file tests passed! ===');
}

testEdit().catch(console.error);
