/**
 * src/tests/test-memory-manager.ts
 *
 * 测试目标：验证 MemoryManager（记忆管理系统）
 * 阶段：Phase 4 (v3.2.0) — 记忆管理
 * 依赖：无（不需要 API Key，不需要网络）
 *
 * 测试用例：
 * 1. 初始加载（无文件）→ 返回空记忆列表
 * 2. 添加记忆 → 写入文件
 * 3. 添加多条 → 按 tag 筛选
 * 4. 删除记忆 → 文件同步更新
 * 5. ID 自增 → P001 → P002 → P003
 * 6. getFormatted 输出格式
 * 7. 重复加载不丢失数据
 * 8. 空内容容错 → 损坏的 MEMORY.md 不崩溃
 * 9. 删除不存在的记忆 → 返回 false
 * 10. 序列化/反序列化一致性
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MemoryManager } from '../session/memory-manager.js';
import type { MemoryTag } from '../session/memory-manager.js';

// ═══════════════════════════════════════════════════════
// 测试工具
// ═══════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let testDir = '';

function assert(condition: boolean, testName: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.error(`  ❌ ${testName}`);
  }
}

// ═══════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════

/** 为每个测试创建独立的子目录，避免文件残留干扰 */
async function makeTestSubDir(name: string): Promise<string> {
  const dir = path.join(testDir, name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function testInitialLoadEmpty() {
  const dir = await makeTestSubDir('test-empty');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  assert(manager.getAll().length === 0, '初始加载（无文件）→ 返回空列表');
}

async function testAddAndPersist() {
  const dir = await makeTestSubDir('test-add');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  const entry = await manager.add('preference', '用户偏好 pnpm 而非 npm');

  assert(entry.id === 'P001', `添加记忆 → ID 正确 (${entry.id})`);
  assert(entry.tag === 'preference', '添加记忆 → tag 正确');
  assert(entry.content === '用户偏好 pnpm 而非 npm', '添加记忆 → content 正确');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.date), '添加记忆 → date 格式正确');

  // 验证文件已写入
  const content = await fs.readFile(manager.getMemoryPath(), 'utf-8');
  assert(content.includes('[P001]'), '添加记忆 → 文件包含 [P001]');
  assert(content.includes('长期记忆'), '添加记忆 → 文件包含标题');
}

async function testAddMultipleAndFilterByTag() {
  const dir = await makeTestSubDir('test-filter');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  await manager.add('preference', '偏好1');
  await manager.add('preference', '偏好2');
  await manager.add('decision', '决策1');
  await manager.add('knowledge', '知识1');

  const prefs = manager.getByTag('preference');
  assert(prefs.length === 2, `按 tag 筛选 → preference 有 2 条 (实际 ${prefs.length})`);

  const decisions = manager.getByTag('decision');
  assert(decisions.length === 1, `按 tag 筛选 → decision 有 1 条 (实际 ${decisions.length})`);

  const todos = manager.getByTag('todo');
  assert(todos.length === 0, `按 tag 筛选 → todo 有 0 条 (实际 ${todos.length})`);
}

async function testRemove() {
  const dir = await makeTestSubDir('test-remove');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  await manager.add('preference', '待删除的记忆');
  assert(manager.getAll().length === 1, '删除前 → 有 1 条记忆');

  const removed = await manager.remove('P001');
  assert(removed === true, '删除记忆 → 返回 true');
  assert(manager.getAll().length === 0, '删除后 → 记忆列表为空');

  // 验证文件已更新
  const content = await fs.readFile(manager.getMemoryPath(), 'utf-8');
  assert(!content.includes('待删除的记忆'), '删除后 → 文件不包含已删除内容');
}

async function testIdAutoIncrement() {
  const dir = await makeTestSubDir('test-id-inc');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  const e1 = await manager.add('preference', '第一');
  const e2 = await manager.add('preference', '第二');
  const e3 = await manager.add('preference', '第三');

  assert(e1.id === 'P001', `ID 自增 → 第一个 ${e1.id}`);
  assert(e2.id === 'P002', `ID 自增 → 第二个 ${e2.id}`);
  assert(e3.id === 'P003', `ID 自增 → 第三个 ${e3.id}`);
}

async function testIdAutoIncrementAcrossTags() {
  const dir = await makeTestSubDir('test-id-cross');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  const e1 = await manager.add('decision', 'T1');
  const e2 = await manager.add('knowledge', 'K1');
  const e3 = await manager.add('decision', 'T2');

  assert(e1.id === 'T001', `跨 tag → T1 是 ${e1.id}`);
  assert(e2.id === 'K001', `跨 tag → K1 是 ${e2.id}`);
  assert(e3.id === 'T002', `跨 tag → T2 是 ${e3.id}`);
}

async function testGetFormatted() {
  const dir = await makeTestSubDir('test-formatted');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  await manager.add('preference', '测试偏好');
  await manager.add('decision', '测试决策');

  const formatted = manager.getFormatted();
  assert(formatted.includes('# 长期记忆'), '格式化 → 包含标题');
  assert(formatted.includes('## 偏好'), '格式化 → 包含偏好分类');
  assert(formatted.includes('## 技术决策'), '格式化 → 包含技术决策分类');
  assert(formatted.includes('[P001]'), '格式化 → 包含记忆 ID');
  assert(formatted.includes('测试偏好'), '格式化 → 包含记忆内容');
}

async function testReloadPersistence() {
  const dir = await makeTestSubDir('test-reload');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  await manager.add('preference', '持久化测试');
  await manager.add('decision', '决策持久化测试');

  // 创建新的 manager 模拟重启
  const manager2 = new MemoryManager({ workDir: dir });
  await manager2.load();

  const all = manager2.getAll();
  assert(all.length === 2, `重复加载 → 2 条记忆 (实际 ${all.length})`);

  const hasPref = all.some(e => e.id === 'P001' && e.content === '持久化测试');
  assert(hasPref, '重复加载 → 偏好记忆正确');

  const hasDec = all.some(e => e.id === 'T001' && e.content === '决策持久化测试');
  assert(hasDec, '重复加载 → 决策记忆正确');
}

async function testCorruptedFileGraceful() {
  const dir = await makeTestSubDir('test-corrupted');
  const manager = new MemoryManager({ workDir: dir });

  // 写入损坏的 MEMORY.md
  const corruptedContent = `
# 长期记忆

这不是一个合法的记忆条目
- [X999] 无效前缀 (2026-01-01)
- [Pabc] 无效数字 (2026-01-01)
随机文本
- [P001] 这条是有效的 (2026-03-28)
更多随机文本
  `;
  await fs.mkdir(path.dirname(manager.getMemoryPath()), { recursive: true });
  await fs.writeFile(manager.getMemoryPath(), corruptedContent, 'utf-8');

  await manager.load();
  const all = manager.getAll();

  // 应该只解析出 1 条有效记忆
  assert(all.length === 1, `损坏文件 → 解析出 1 条有效记忆 (实际 ${all.length})`);
  assert(all[0].id === 'P001', '损坏文件 → 正确解析有效条目');
  assert(all[0].content === '这条是有效的', '损坏文件 → 内容正确');
}

async function testRemoveNonExistent() {
  const dir = await makeTestSubDir('test-remove-nonexist');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  const removed = await manager.remove('Z999');
  assert(removed === false, '删除不存在的记忆 → 返回 false');
}

async function testEmptySerialize() {
  const dir = await makeTestSubDir('test-empty-serialize');
  const manager = new MemoryManager({ workDir: dir });
  await manager.load();

  const formatted = manager.getFormatted();
  assert(formatted === '', '空记忆 → getFormatted 返回空字符串');

  // 保存后文件应该有基本结构
  await manager.save();
  const content = await fs.readFile(manager.getMemoryPath(), 'utf-8');
  assert(content.includes('# 长期记忆'), '空记忆保存 → 文件包含标题');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  testDir = path.join(os.tmpdir(), `firmclaw-test-memory-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`\n📋 MemoryManager 单元测试`);
  console.log(`   测试目录: ${testDir}\n`);

  await testInitialLoadEmpty();
  await testAddAndPersist();
  await testAddMultipleAndFilterByTag();
  await testRemove();
  await testIdAutoIncrement();
  await testIdAutoIncrementAcrossTags();
  await testGetFormatted();
  await testReloadPersistence();
  await testCorruptedFileGraceful();
  await testRemoveNonExistent();
  await testEmptySerialize();

  // 清理
  await fs.rm(testDir, { recursive: true, force: true });

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('测试运行失败:', error);
  process.exit(1);
});
