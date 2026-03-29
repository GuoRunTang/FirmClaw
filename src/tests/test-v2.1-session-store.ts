/**
 * src/tests/test-session-store.ts
 *
 * 测试目标：验证 SessionStore（JSONL 存储层）
 * 阶段：Phase 3 (v2.1.0) — 会话存储与管理
 * 依赖：无（不需要 API Key，不需要网络）
 *
 * 测试用例：
 * 1. 创建会话 → 文件存在
 * 2. append 单条 → 读取验证
 * 3. appendBatch → 顺序正确
 * 4. readMessages → 跳过 #META
 * 5. readMeta → 返回正确元数据
 * 6. updateMeta → 更新成功
 * 7. listAll → 包含新创建的
 * 8. delete → 文件消失
 * 9. 无效 sessionId → 抛错（路径遍历防护）
 * 10. 读取不存在的会话 → 返回空
 * 11. 空 appendBatch → 不报错
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionStore } from '../session/store.js';
import type { SessionMeta, StoredMessage } from '../session/types.js';

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

async function assertThrows(fn: () => Promise<unknown>, testName: string): Promise<void> {
  try {
    await fn();
    failed++;
    console.error(`  ❌ ${testName} (未抛出异常)`);
  } catch {
    passed++;
    console.log(`  ✅ ${testName}`);
  }
}

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
  return {
    id: 'test-session-001',
    createdAt: '2026-03-28T10:00:00.000Z',
    updatedAt: '2026-03-28T10:00:00.000Z',
    workDir: '/tmp/test',
    title: '测试会话',
    messageCount: 0,
    ...overrides,
  };
}

function makeMsg(overrides?: Partial<StoredMessage>): StoredMessage {
  return {
    role: 'user',
    content: '你好',
    timestamp: '2026-03-28T10:00:01.000Z',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════

async function testCreateAndFileExists() {
  const store = new SessionStore(testDir);
  const meta = makeMeta();

  await store.create(meta);

  const content = await fs.readFile(store.filePath(meta.id), 'utf-8');
  assert(content.startsWith('#META '), '创建会话 → 文件存在且以 #META 开头');
  assert(content.includes(meta.id), '文件内容包含会话 ID');
  assert(content.includes(meta.title), '文件内容包含会话标题');
}

async function testAppendSingle() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-append-single' });

  await store.create(meta);
  const msg = makeMsg({ content: '追加测试' });
  await store.append(meta.id, msg);

  const messages = await store.readMessages(meta.id);
  assert(messages.length === 1, 'append 单条 → 消息数量为 1');
  assert(messages[0].content === '追加测试', 'append 单条 → 内容正确');
  assert(messages[0].role === 'user', 'append 单条 → 角色正确');
}

async function testAppendBatch() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-append-batch' });

  await store.create(meta);
  const messages = [
    makeMsg({ content: '第一条', timestamp: '2026-03-28T10:00:01.000Z' }),
    makeMsg({ content: '第二条', role: 'assistant', timestamp: '2026-03-28T10:00:02.000Z' }),
    makeMsg({ content: '第三条', timestamp: '2026-03-28T10:00:03.000Z' }),
  ];
  await store.appendBatch(meta.id, messages);

  const read = await store.readMessages(meta.id);
  assert(read.length === 3, 'appendBatch → 消息数量为 3');
  assert(read[0].content === '第一条', 'appendBatch → 第一条内容正确');
  assert(read[1].content === '第二条', 'appendBatch → 第二条内容正确');
  assert(read[1].role === 'assistant', 'appendBatch → 第二条角色正确');
  assert(read[2].content === '第三条', 'appendBatch → 第三条内容正确');
}

async function testReadMessagesSkipsMeta() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-skip-meta' });

  await store.create(meta);
  await store.append(meta.id, makeMsg({ content: '消息1' }));
  await store.append(meta.id, makeMsg({ content: '消息2' }));

  const messages = await store.readMessages(meta.id);
  assert(messages.length === 2, 'readMessages → 跳过 #META，只返回 2 条消息');
  assert(messages.every(m => m.role !== undefined), 'readMessages → 所有消息都有 role 字段');
}

async function testReadMeta() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-read-meta', title: '元数据测试' });

  await store.create(meta);

  const read = await store.readMeta(meta.id);
  assert(read !== null, 'readMeta → 返回非 null');
  assert(read!.id === 'test-read-meta', 'readMeta → ID 正确');
  assert(read!.title === '元数据测试', 'readMeta → 标题正确');
  assert(read!.messageCount === 0, 'readMeta → 消息数正确');
}

async function testUpdateMeta() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-update-meta', messageCount: 5 });

  await store.create(meta);
  await store.append(meta.id, makeMsg());
  await store.updateMeta(meta.id, { messageCount: 10, title: '更新后' });

  const read = await store.readMeta(meta.id);
  assert(read!.messageCount === 10, 'updateMeta → messageCount 更新为 10');
  assert(read!.title === '更新后', 'updateMeta → title 更新');

  // 确保消息没有被破坏
  const messages = await store.readMessages(meta.id);
  assert(messages.length === 1, 'updateMeta → 消息未被破坏');
}

async function testListAll() {
  const store = new SessionStore(testDir);

  // 创建多个会话
  await store.create(makeMeta({ id: 'list-a', createdAt: '2026-03-28T10:00:00.000Z', updatedAt: '2026-03-28T12:00:00.000Z' }));
  await store.create(makeMeta({ id: 'list-b', createdAt: '2026-03-28T09:00:00.000Z', updatedAt: '2026-03-28T13:00:00.000Z' }));
  await store.create(makeMeta({ id: 'list-c', createdAt: '2026-03-28T11:00:00.000Z', updatedAt: '2026-03-28T11:30:00.000Z' }));

  const all = await store.listAll();
  assert(all.length >= 3, `listAll → 至少有 3 个会话（实际 ${all.length}）`);
  // 按 updatedAt 降序
  if (all.length >= 3) {
    assert(all[0].id === 'list-b', 'listAll → 第一个是最近更新的 (list-b)');
  }
}

async function testDelete() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-delete' });

  await store.create(meta);
  await store.delete(meta.id);

  const messages = await store.readMessages(meta.id);
  assert(messages.length === 0, 'delete → 消息为空');

  const readMeta = await store.readMeta(meta.id);
  assert(readMeta === null, 'delete → 元数据为 null');
}

async function testInvalidSessionId() {
  const store = new SessionStore(testDir);
  const meta = makeMeta();

  // 路径遍历攻击
  await assertThrows(
    () => store.append('../../etc/passwd', makeMsg()),
    '无效 sessionId（路径遍历）→ 抛错'
  );

  await assertThrows(
    () => store.append('../escape', makeMsg()),
    '无效 sessionId（.. 前缀）→ 抛错'
  );
}

async function testReadNonExistent() {
  const store = new SessionStore(testDir);

  const messages = await store.readMessages('nonexistent-12345');
  assert(messages.length === 0, '读取不存在的会话 → 返回空数组');

  const meta = await store.readMeta('nonexistent-12345');
  assert(meta === null, '读取不存在的会话 meta → 返回 null');
}

async function testEmptyBatch() {
  const store = new SessionStore(testDir);
  const meta = makeMeta({ id: 'test-empty-batch' });

  await store.create(meta);
  await store.appendBatch(meta.id, []); // 空 batch 不应该报错

  const messages = await store.readMessages(meta.id);
  assert(messages.length === 0, '空 appendBatch → 消息数为 0');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  // 创建临时测试目录
  testDir = path.join(os.tmpdir(), `firmclaw-test-store-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`\n📋 SessionStore 单元测试`);
  console.log(`   测试目录: ${testDir}\n`);

  await testCreateAndFileExists();
  await testAppendSingle();
  await testAppendBatch();
  await testReadMessagesSkipsMeta();
  await testReadMeta();
  await testUpdateMeta();
  await testListAll();
  await testDelete();
  await testInvalidSessionId();
  await testReadNonExistent();
  await testEmptyBatch();

  // 清理临时目录
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
