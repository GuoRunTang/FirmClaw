/**
 * src/tests/test-permissions.ts
 *
 * 测试目标：验证权限策略系统
 * - 不需要 API Key，不需要网络
 * - 验证：路径白名单、命令黑名单、敏感文件保护
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../tools/registry.js';
import { bashTool } from '../tools/bash.js';
import { readTool } from '../tools/read.js';
import { writeTool } from '../tools/write.js';
import { editTool } from '../tools/edit.js';
import { DefaultPermissionPolicy } from '../tools/permissions.js';
import type { ToolContext } from '../tools/context.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'firmclaw-test-'));
}

async function testPermissions() {
  console.log('=== Test: Permission System ===\n');

  const tmp = tmpDir();
  const tmpCtx: ToolContext = { workDir: tmp };

  // 创建测试文件
  const testFile = path.join(tmp, 'test.txt');
  fs.writeFileSync(testFile, 'hello\n', 'utf-8');

  // ──── Part 1: 无权限策略时所有操作正常 ────
  console.log('[1] Without policy: all operations allowed');
  const noPolicy = new ToolRegistry();
  noPolicy.register(readTool);
  noPolicy.register(writeTool);
  const r1 = await noPolicy.execute('read_file', { path: testFile }, tmpCtx);
  console.log(`   Read: ${!r1.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r1.isError, 'FAIL: read should work without policy');
  console.log('   PASS\n');

  // ──── Part 2: 路径白名单 ────
  console.log('[2] Path whitelist: allow workDir, deny outside');
  const policy = new DefaultPermissionPolicy({ allowedPaths: [tmp] });
  const reg = new ToolRegistry();
  reg.register(readTool);
  reg.register(writeTool);
  reg.register(editTool);
  reg.register(bashTool);
  reg.setPolicy(policy);

  // 2a: 读取 workDir 内文件 → 允许
  const r2a = await reg.execute('read_file', { path: testFile }, tmpCtx);
  console.log(`   [2a] Read inside workDir: ${!r2a.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r2a.isError, 'FAIL: should allow read inside workDir');

  // 2b: 读取 workDir 外文件 → 拒绝
  const r2b = await reg.execute('read_file', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }, tmpCtx);
  console.log(`   [2b] Read outside workDir: ${r2b.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r2b.isError === true, 'FAIL: should deny read outside workDir');
  console.assert(r2b.content.includes('Permission denied'), 'FAIL: should mention permission');

  // 2c: 写入 workDir 内文件 → 允许
  const writeTarget = path.join(tmp, 'new.txt');
  const r2c = await reg.execute('write_file', { path: writeTarget, content: 'test' }, tmpCtx);
  console.log(`   [2c] Write inside workDir: ${!r2c.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r2c.isError, 'FAIL: should allow write inside workDir');

  // 2d: 写入 workDir 外文件 → 拒绝
  const r2d = await reg.execute('write_file', { path: 'C:\\Windows\\test.txt', content: 'hack' }, tmpCtx);
  console.log(`   [2d] Write outside workDir: ${r2d.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r2d.isError === true, 'FAIL: should deny write outside workDir');

  // 2e: 编辑 workDir 内文件 → 允许
  const r2e = await reg.execute('edit_file', { path: testFile, old_str: 'hello', new_str: 'world' }, tmpCtx);
  console.log(`   [2e] Edit inside workDir: ${!r2e.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r2e.isError, 'FAIL: should allow edit inside workDir');

  // 2f: 编辑 workDir 外文件 → 拒绝
  const r2f = await reg.execute('edit_file', { path: 'C:\\test.txt', old_str: 'a', new_str: 'b' }, tmpCtx);
  console.log(`   [2f] Edit outside workDir: ${r2f.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r2f.isError === true, 'FAIL: should deny edit outside workDir');
  console.log('   PASS\n');

  // ──── Part 3: 命令黑名单 ────
  console.log('[3] Command blacklist');

  // 3a: 正常命令 → 允许
  const r3a = await reg.execute('bash', { command: 'echo hello' }, tmpCtx);
  console.log(`   [3a] Normal command: ${!r3a.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r3a.isError, 'FAIL: should allow normal command');

  // 3b: 黑名单命令 → 拒绝
  const r3b = await reg.execute('bash', { command: 'shutdown /s /t 0' }, tmpCtx);
  console.log(`   [3b] Shutdown command: ${r3b.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r3b.isError === true, 'FAIL: should deny shutdown');
  console.assert(r3b.content.includes('Permission denied'), 'FAIL: should mention permission');

  // 3c: 黑名单命令 → 拒绝
  const r3c = await reg.execute('bash', { command: 'rm -rf /' }, tmpCtx);
  console.log(`   [3c] rm -rf /: ${r3c.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r3c.isError === true, 'FAIL: should deny rm -rf /');

  // 3d: 正常构建命令 → 允许（验证权限放行，不关心命令是否成功执行）
  const r3d = await reg.execute('bash', { command: 'echo ok' }, tmpCtx);
  console.log(`   [3d] Normal echo command: ${!r3d.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r3d.isError, 'FAIL: should allow echo');
  console.log('   PASS\n');

  // ──── Part 4: 敏感文件保护 ────
  console.log('[4] Protected files');

  // 4a: 写入 .env → 拒绝
  const r4a = await reg.execute('write_file', { path: path.join(tmp, '.env'), content: 'SECRET=xxx' }, tmpCtx);
  console.log(`   [4a] Write .env: ${r4a.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r4a.isError === true, 'FAIL: should deny writing .env');
  console.assert(r4a.content.includes('protected file'), 'FAIL: should mention protected');

  // 4b: 读取 .env → 允许（读取不受限制）
  const envFile = path.join(tmp, '.env');
  fs.writeFileSync(envFile, 'KEY=abc\n', 'utf-8');
  const r4b = await reg.execute('read_file', { path: envFile }, tmpCtx);
  console.log(`   [4b] Read .env: ${!r4b.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r4b.isError, 'FAIL: should allow reading .env');

  // 4c: 编辑 .env → 拒绝
  const r4c = await reg.execute('edit_file', { path: envFile, old_str: 'KEY=abc', new_str: 'KEY=hacked' }, tmpCtx);
  console.log(`   [4c] Edit .env: ${r4c.isError ? 'DENIED' : 'FAIL'}`);
  console.assert(r4c.isError === true, 'FAIL: should deny editing .env');

  // 4d: 写入普通文件 → 允许
  const r4d = await reg.execute('write_file', { path: path.join(tmp, 'normal.txt'), content: 'ok' }, tmpCtx);
  console.log(`   [4d] Write normal file: ${!r4d.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r4d.isError, 'FAIL: should allow writing normal file');
  console.log('   PASS\n');

  // ──── Part 5: 额外允许路径 ────
  console.log('[5] Extra allowed paths');
  const extraDir = tmpDir();
  fs.writeFileSync(path.join(extraDir, 'extra.txt'), 'extra content\n', 'utf-8');
  policy.addExtraAllowedPath(extraDir);

  // 5a: 额外允许路径内 → 允许
  const extraCtx: ToolContext = { workDir: tmp }; // workDir 仍为 tmp
  const r5a = await reg.execute('read_file', { path: path.join(extraDir, 'extra.txt') }, extraCtx);
  console.log(`   [5a] Read in extra allowed path: ${!r5a.isError ? 'OK' : 'FAIL'}`);
  console.assert(!r5a.isError, 'FAIL: should allow read in extra allowed path');
  console.log('   PASS\n');

  // 清理
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(extraDir, { recursive: true, force: true });

  console.log('=== All permission tests passed! ===');
}

testPermissions().catch(console.error);
