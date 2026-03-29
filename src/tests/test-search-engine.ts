/**
 * src/tests/test-search-engine.ts
 *
 * 测试目标：验证 SearchEngine（BM25 全文搜索引擎）
 * 阶段：Phase 4 (v3.3.0) — 全文搜索
 * 依赖：无（不需要 API Key，不需要网络）
 *
 * 测试用例：
 * 1. 添加文档 → 搜索命中
 * 2. 多文档 → 相关性排序
 * 3. 中文搜索（bigram 分词）
 * 4. 英文搜索（单词分词）
 * 5. 混合中英文搜索
 * 6. 无结果 → 返回空数组
 * 7. 删除文档 → 搜索不命中
 * 8. 索引持久化 → 加载后搜索
 * 9. 大量文档性能（1000 文档搜索 < 100ms）
 * 10. 空查询 → 返回空
 * 11. searchMemory 便捷方法
 * 12. getStats 统计信息
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SearchEngine } from '../session/search-engine.js';
import type { SearchDocument, MemoryEntry } from '../session/search-engine.js';
import type { MemoryEntry as FullMemoryEntry } from '../session/memory-manager.js';

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

async function testBasicSearch() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: 'FirmClaw 使用 ReAct 架构来实现智能体循环',
    timestamp: new Date().toISOString(),
  });

  const results = engine.search('ReAct');
  assert(results.length > 0, '基础搜索 → 命中文档');
  assert(results[0].id === 'doc1', '基础搜索 → 正确的文档 ID');
  assert(results[0].score > 0, `基础搜索 → 得分大于 0 (${results[0].score})`);
}

async function testMultiDocRelevanceSorting() {
  const engine = new SearchEngine();

  // 文档 1: 多次提到 "TypeScript"
  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: 'TypeScript TypeScript TypeScript 项目使用 TypeScript strict 模式开发',
    timestamp: new Date().toISOString(),
  });

  // 文档 2: 只提到一次 "TypeScript"
  engine.addDocument({
    id: 'doc2',
    source: 'session',
    content: '这个项目使用 TypeScript 编写，其他功能包括文件读取和编辑',
    timestamp: new Date().toISOString(),
  });

  // 文档 3: 不相关
  engine.addDocument({
    id: 'doc3',
    source: 'session',
    content: '今天的天气很好，适合出去散步',
    timestamp: new Date().toISOString(),
  });

  const results = engine.search('TypeScript');
  assert(results.length >= 2, `多文档排序 → 至少 2 条结果 (实际 ${results.length})`);

  // doc1 应该排在 doc2 前面（词频更高）
  if (results.length >= 2) {
    assert(results[0].id === 'doc1', `多文档排序 → doc1 排第一 (实际 ${results[0].id})`);
    assert(results[0].score >= results[1].score,
      `多文档排序 → 第一条得分 >= 第二条 (${results[0].score} >= ${results[1].score})`);
  }
}

async function testChineseSearch() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'memory',
    content: '用户偏好使用中文进行代码注释',
    timestamp: new Date().toISOString(),
  });

  // 中文 bigram 分词："用户"、"户偏"、"偏好"、"好使"、"使用"、"用中"、"中文"、"文进"、"进行"、"代码"、"码注"、"注释"
  const results = engine.search('中文');
  assert(results.length > 0, '中文搜索 → 命中文档');

  const results2 = engine.search('用户');
  assert(results2.length > 0, '中文搜索（用户）→ 命中文档');

  const results3 = engine.search('偏好');
  assert(results3.length > 0, '中文搜索（偏好）→ 命中文档');
}

async function testEnglishSearch() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: 'The agent uses ReAct architecture for reasoning and acting',
    timestamp: new Date().toISOString(),
  });

  const results = engine.search('react');
  assert(results.length > 0, '英文搜索 → 命中文档');

  const results2 = engine.search('architecture');
  assert(results2.length > 0, '英文搜索（architecture）→ 命中文档');
}

async function testMixedChineseEnglishSearch() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: 'FirmClaw 是一个基于 TypeScript 的 ReAct 智能体框架',
    timestamp: new Date().toISOString(),
  });

  const results = engine.search('FirmClaw 智能体');
  assert(results.length > 0, '混合搜索 → 命中文档');
}

async function testNoResults() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: '关于 Python 编程的内容',
    timestamp: new Date().toISOString(),
  });

  const results = engine.search('量子物理');
  assert(results.length === 0, '无结果 → 返回空数组');
}

async function testDeleteDocument() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: '关于 TypeScript 的内容',
    timestamp: new Date().toISOString(),
  });

  assert(engine.search('TypeScript').length > 0, '删除前 → 搜索命中');

  const removed = engine.removeDocument('doc1');
  assert(removed === true, '删除文档 → 返回 true');

  const results = engine.search('TypeScript');
  assert(results.length === 0, '删除后 → 搜索不命中');

  // 删除不存在的文档
  const removed2 = engine.removeDocument('nonexistent');
  assert(removed2 === false, '删除不存在的文档 → 返回 false');
}

async function testPersistAndLoad() {
  const indexDir = path.join(testDir, 'index');
  const engine1 = new SearchEngine({ indexDir });

  engine1.addDocument({
    id: 'doc1',
    source: 'memory',
    content: '持久化测试文档',
    timestamp: new Date().toISOString(),
  });
  engine1.addDocument({
    id: 'doc2',
    source: 'session',
    content: '第二篇测试文档',
    timestamp: new Date().toISOString(),
  });

  await engine1.persist();

  // 创建新的 engine 加载索引
  const engine2 = new SearchEngine({ indexDir });
  await engine2.load();

  const results = engine2.search('持久化');
  assert(results.length > 0, '持久化加载 → 搜索命中');
  assert(results[0].id === 'doc1', '持久化加载 → 正确的文档 ID');
}

async function testLargeScalePerformance() {
  const engine = new SearchEngine();

  // 添加 1000 个文档
  for (let i = 0; i < 1000; i++) {
    engine.addDocument({
      id: `doc-${i}`,
      source: i % 2 === 0 ? 'session' : 'tool_result',
      content: `文档 ${i}: 这是测试内容，包含关键词 ${i % 10} 和一些随机文本填充数据`,
      timestamp: new Date().toISOString(),
    });
  }

  // 测量搜索时间
  const start = Date.now();
  const results = engine.search('关键词 5');
  const elapsed = Date.now() - start;

  assert(results.length > 0, '大量文档 → 搜索有结果');
  assert(elapsed < 100, `大量文档性能 → 搜索耗时 ${elapsed}ms < 100ms`);
}

async function testEmptyQuery() {
  const engine = new SearchEngine();

  engine.addDocument({
    id: 'doc1',
    source: 'session',
    content: '一些内容',
    timestamp: new Date().toISOString(),
  });

  const results1 = engine.search('');
  assert(results1.length === 0, '空查询 → 返回空');

  const results2 = engine.search('   ');
  assert(results2.length === 0, '纯空格查询 → 返回空');
}

async function testSearchMemory() {
  const engine = new SearchEngine();

  const entries: FullMemoryEntry[] = [
    { id: 'P001', tag: 'preference', content: '用户偏好使用 pnpm', date: '2026-03-28' },
    { id: 'T001', tag: 'decision', content: '使用 TypeScript strict 模式', date: '2026-03-28' },
    { id: 'K001', tag: 'knowledge', content: 'FirmClaw 使用 ReAct 架构', date: '2026-03-29' },
  ];

  const results = engine.searchMemory('pnpm', entries);
  assert(results.length === 1, `searchMemory → 找到 1 条 (实际 ${results.length})`);
  assert(results[0] === 'P001', `searchMemory → 正确的 ID (${results[0]})`);

  const results2 = engine.searchMemory('TypeScript', entries);
  assert(results2.length === 1, `searchMemory（TypeScript）→ 找到 1 条 (实际 ${results2.length})`);
  assert(results2[0] === 'T001', `searchMemory → 正确的 ID (${results2[0]})`);
}

async function testGetStats() {
  const engine = new SearchEngine();

  engine.addDocument({ id: 'd1', source: 'session', content: 's1', timestamp: '' });
  engine.addDocument({ id: 'd2', source: 'session', content: 's2', timestamp: '' });
  engine.addDocument({ id: 'd3', source: 'memory', content: 'm1', timestamp: '' });
  engine.addDocument({ id: 'd4', source: 'tool_result', content: 't1', timestamp: '' });

  const stats = engine.getStats();
  assert(stats.docCount === 4, `统计 → 文档数 4 (实际 ${stats.docCount})`);
  assert(stats.sources['session'] === 2, `统计 → session 有 2 条`);
  assert(stats.sources['memory'] === 1, `统计 → memory 有 1 条`);
  assert(stats.sources['tool_result'] === 1, `统计 → tool_result 有 1 条`);
}

async function testClear() {
  const engine = new SearchEngine();

  engine.addDocument({ id: 'd1', source: 'session', content: 'test', timestamp: '' });
  engine.addDocument({ id: 'd2', source: 'session', content: 'test2', timestamp: '' });

  assert(engine.getStats().docCount === 2, '清空前 → 2 个文档');

  engine.clear();

  assert(engine.getStats().docCount === 0, '清空后 → 0 个文档');
  assert(engine.search('test').length === 0, '清空后 → 搜索无结果');
}

async function testUpdateExistingDocument() {
  const engine = new SearchEngine();

  engine.addDocument({ id: 'd1', source: 'session', content: 'apple banana cherry', timestamp: '' });
  assert(engine.search('apple').length === 1, '更新前 → 旧内容可搜索');

  // 更新同一 ID 的文档（使用完全不重叠的词汇）
  engine.addDocument({ id: 'd1', source: 'session', content: 'dog elephant frog', timestamp: '' });

  assert(engine.search('dog').length === 1, '更新后 → 新内容可搜索');
  assert(engine.search('apple').length === 0, '更新后 → 旧内容不可搜索');
  assert(engine.getStats().docCount === 1, '更新后 → 文档数仍为 1');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  testDir = path.join(os.tmpdir(), `firmclaw-test-search-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`\n📋 SearchEngine 单元测试`);
  console.log(`   测试目录: ${testDir}\n`);

  await testBasicSearch();
  await testMultiDocRelevanceSorting();
  await testChineseSearch();
  await testEnglishSearch();
  await testMixedChineseEnglishSearch();
  await testNoResults();
  await testDeleteDocument();
  await testPersistAndLoad();
  await testLargeScalePerformance();
  await testEmptyQuery();
  await testSearchMemory();
  await testGetStats();
  await testClear();
  await testUpdateExistingDocument();

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
