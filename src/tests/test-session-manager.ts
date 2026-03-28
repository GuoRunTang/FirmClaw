/**
 * src/tests/test-session-manager.ts
 *
 * SessionManager 单元测试。
 *
 * 测试用例：
 * 1. create → 返回有效 meta
 * 2. create + append + getMessages → 数据完整
 * 3. resume 已有会话 → 能读到历史
 * 4. resumeLatest → 返回最新的
 * 5. listSessions → 按时间降序
 * 6. gc → 清理过期会话
 * 7. 切换会话 → 正确切换
 * 8. 禁用模式 → isEnabled() 返回 false
 *
 * v2.1
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionManager } from '../session/manager.js';
import type { StoredMessage } from '../session/types.js';

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

function makeMsg(overrides?: Partial<StoredMessage>): StoredMessage {
  return {
    role: 'user',
    content: '测试消息',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════

async function testCreate() {
  const manager = new SessionManager({ storageDir: testDir });
  const meta = await manager.create('/tmp/test', '第一条消息');

  assert(typeof meta.id === 'string' && meta.id.length > 0, 'create → 返回有效 ID');
  assert(meta.workDir === '/tmp/test', 'create → workDir 正确');
  assert(meta.title === '第一条消息', 'create → 标题正确');
  assert(meta.messageCount === 0, 'create → 初始消息数为 0');
  assert(manager.getCurrentSessionId() === meta.id, 'create → 设置为当前会话');
  assert(manager.getCurrentMeta()?.id === meta.id, 'create → getCurrentMeta 返回正确');
}

async function testCreateAndAppendAndGetMessages() {
  const manager = new SessionManager({ storageDir: testDir });
  await manager.create('/tmp/test', '你好');

  const now = new Date().toISOString();
  await manager.append([
    makeMsg({ role: 'user', content: '问题1', timestamp: now }),
    makeMsg({ role: 'assistant', content: '回答1', timestamp: now }),
    makeMsg({ role: 'user', content: '问题2', timestamp: now }),
  ]);

  const messages = await manager.getMessages();
  assert(messages.length === 3, '端到端 → 消息数量为 3');
  assert(messages[0].role === 'user' && messages[0].content === '问题1', '端到端 → 第一条正确');
  assert(messages[1].role === 'assistant' && messages[1].content === '回答1', '端到端 → 第二条正确');
  assert(messages[2].role === 'user' && messages[2].content === '问题2', '端到端 → 第三条正确');

  // getMessages 返回的 Message 没有 timestamp 字段（已被 toLLMMessage 剥离）
  assert(!(messages[0] as Record<string, unknown>).timestamp, '端到端 → 消息无 timestamp 字段');
}

async function testResume() {
  const manager = new SessionManager({ storageDir: testDir });
  const created = await manager.create('/tmp/test', '原始会话');

  await manager.append([makeMsg({ content: '历史消息' })]);

  // 创建一个新的 manager 模拟重启
  const manager2 = new SessionManager({ storageDir: testDir });
  const resumed = await manager2.resume(created.id);

  assert(resumed.id === created.id, 'resume → ID 匹配');
  assert(resumed.title === '原始会话', 'resume → 标题匹配');

  const messages = await manager2.getMessages();
  assert(messages.length === 1, 'resume → 能读到历史消息');
  assert(messages[0].content === '历史消息', 'resume → 历史消息内容正确');
}

async function testResumeLatest() {
  const manager = new SessionManager({ storageDir: testDir });

  // 创建 3 个会话
  const m1 = await manager.create('/tmp/test', '会话1');
  await manager.append([makeMsg()]);

  const m2 = await manager.create('/tmp/test', '会话2');
  await manager.append([makeMsg()]);

  const m3 = await manager.create('/tmp/test', '会话3');
  await manager.append([makeMsg()]);

  // 新 manager 恢复最近的
  const manager2 = new SessionManager({ storageDir: testDir });
  const latest = await manager2.resumeLatest();

  assert(latest !== null, 'resumeLatest → 返回非 null');
  // 最近创建的应该是 m3
  assert(latest!.id === m3.id, 'resumeLatest → 返回最新的会话 (m3)');
}

async function testListSessions() {
  const manager = new SessionManager({ storageDir: testDir });

  await manager.create('/tmp/test', 'AAA');
  await manager.append([makeMsg()]);
  await manager.create('/tmp/test', 'BBB');
  await manager.append([makeMsg()]);

  const sessions = await manager.listSessions();
  assert(sessions.length >= 2, `listSessions → 至少 2 个会话（实际 ${sessions.length}）`);
  // 按 updatedAt 降序
  if (sessions.length >= 2) {
    const t0 = new Date(sessions[0].updatedAt).getTime();
    const t1 = new Date(sessions[1].updatedAt).getTime();
    assert(t0 >= t1, 'listSessions → 按时间降序排列');
  }
}

async function testGc() {
  const manager = new SessionManager({ storageDir: testDir });

  // 创建一个"旧"会话
  const oldMeta = await manager.create('/tmp/test', '旧会话');
  // 手动将 updatedAt 改为 60 天前（写入磁盘）
  const oldDate = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
  await manager.updateSessionMeta(oldMeta.id, { updatedAt: oldDate });

  // 创建一个"新"会话
  await manager.create('/tmp/test', '新会话');

  // GC 清理超过 30 天的
  const removed = await manager.gc(30);
  assert(removed >= 1, `gc → 清理了至少 1 个过期会话（实际 ${removed}）`);

  // 新会话应该还在
  const sessions = await manager.listSessions();
  const hasNew = sessions.some(s => s.title === '新会话');
  assert(hasNew, 'gc → 新会话未被清理');
}

async function testSwitchSession() {
  const manager = new SessionManager({ storageDir: testDir });

  const m1 = await manager.create('/tmp/test', '会话A');
  await manager.append([makeMsg({ content: 'A的消息' })]);

  const m2 = await manager.create('/tmp/test', '会话B');
  await manager.append([makeMsg({ content: 'B的消息' })]);

  // 切换回会话 A
  manager.switchSession(m1.id);
  const messages = await manager.getMessages();
  assert(messages.length === 1, 'switchSession → 切换后只看到 A 的消息');
  assert(messages[0].content === 'A的消息', 'switchSession → A 的消息内容正确');
}

async function testDisabled() {
  const manager = new SessionManager({ enabled: false });
  assert(!manager.isEnabled(), '禁用模式 → isEnabled() 返回 false');
}

async function testDeleteSession() {
  const manager = new SessionManager({ storageDir: testDir });

  const meta = await manager.create('/tmp/test', '待删除');
  await manager.append([makeMsg()]);

  await manager.deleteSession(meta.id);
  assert(manager.getCurrentSessionId() === null, 'deleteSession → 当前会话被重置');

  const sessions = await manager.listSessions();
  const exists = sessions.some(s => s.id === meta.id);
  assert(!exists, 'deleteSession → 会话从列表中消失');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  testDir = path.join(os.tmpdir(), `firmclaw-test-manager-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`\n📋 SessionManager 单元测试`);
  console.log(`   测试目录: ${testDir}\n`);

  await testCreate();
  await testCreateAndAppendAndGetMessages();
  await testResume();
  await testResumeLatest();
  await testListSessions();
  await testGc();
  await testSwitchSession();
  await testDisabled();
  await testDeleteSession();

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
