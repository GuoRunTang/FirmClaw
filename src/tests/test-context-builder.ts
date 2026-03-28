/**
 * src/tests/test-context-builder.ts
 *
 * ContextBuilder + PromptTemplate 单元测试。
 *
 * v2.2
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContextBuilder } from '../session/context-builder.js';
import { renderTemplate } from '../utils/prompt-template.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import type { SessionMeta } from '../session/types.js';

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
// PromptTemplate 测试
// ═══════════════════════════════════════════════════════

async function testTemplateBasicReplace() {
  const result = renderTemplate('你好 {{name}}，今天是 {{day}}', {
    name: '小明',
    day: '周一',
  });
  assert(result === '你好 小明，今天是 周一', '模板 → 基础变量替换');
}

async function testTemplateDefaultValue() {
  const result = renderTemplate('你好 {{name|匿名用户}}', {});
  assert(result === '你好 匿名用户', '模板 → 默认值替换');
}

async function testTemplateDefaultValueWhenDefined() {
  const result = renderTemplate('你好 {{name|匿名用户}}', { name: '小红' });
  assert(result === '你好 小红', '模板 → 变量有值时忽略默认值');
}

async function testTemplateConditionalTruthy() {
  const result = renderTemplate('开始\n{{#show}}这段内容应该出现{{/show}}\n结束', {
    show: 'yes',
  });
  assert(result.includes('这段内容应该出现'), '模板 → 条件为 truthy 时显示内容');
}

async function testTemplateConditionalFalsy() {
  const result = renderTemplate('开始\n{{#show}}这段不应该出现{{/show}}\n结束', {
    show: undefined,
  });
  assert(!result.includes('这段不应该出现'), '模板 → 条件为 falsy 时隐藏内容');
}

async function testTemplateConditionalEmptyString() {
  const result = renderTemplate('{{#data}}{{data}}{{/data}}', { data: '' });
  assert(!result.includes('空的'), '模板 → 空字符串视为 falsy');
}

async function testTemplateMultipleVariables() {
  const result = renderTemplate('{{a}}-{{b}}-{{c}}', { a: '1', b: '2', c: '3' });
  assert(result === '1-2-3', '模板 → 多变量替换');
}

async function testTemplateCleanup() {
  const result = renderTemplate('第一行\n\n\n\n中间\n\n\n最后', {});
  // 连续空行应被压缩
  assert(!result.includes('\n\n\n'), '模板 → 多余空行被压缩');
}

// ═══════════════════════════════════════════════════════
// ContextBuilder 测试
// ═══════════════════════════════════════════════════════

function makeTool(name: string, desc: string): Tool {
  return {
    name,
    description: desc,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数' },
      },
      required: ['input'],
    },
    execute: async () => ({ content: '', isError: false }),
  };
}

async function testBuildContextNoWorkspaceFiles() {
  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const prompt = await builder.build(registry);
  assert(prompt.includes('bash'), '无工作区文件 → 提示词包含工具名');
  assert(prompt.includes('执行命令'), '无工作区文件 → 提示词包含工具描述');
  assert(prompt.includes('AI 智能体助手'), '无工作区文件 → 包含默认人格描述');
}

async function testBuildContextWithSoul() {
  const configDir = path.join(testDir, '.firmclaw');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'SOUL.md'), '你是一个严肃的法律顾问。\n只回答法律问题。', 'utf-8');

  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const prompt = await builder.build(registry);
  assert(prompt.includes('法律顾问'), '有 SOUL.md → 注入自定义人格');
  assert(prompt.includes('只回答法律问题'), '有 SOUL.md → 注入行为准则');
}

async function testBuildContextWithAgents() {
  const configDir = path.join(testDir, '.firmclaw');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'AGENTS.md'), '- 后端工程师：负责代码\n- 测试工程师：负责测试', 'utf-8');

  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const prompt = await builder.build(registry);
  assert(prompt.includes('协作规则'), '有 AGENTS.md → 注入协作规则');
  assert(prompt.includes('后端工程师'), '有 AGENTS.md → 包含角色定义');
}

async function testBuildContextWithMemory() {
  const configDir = path.join(testDir, '.firmclaw');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'MEMORY.md'), '用户偏好 pnpm 而非 npm。\n项目使用 TypeScript。', 'utf-8');

  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const prompt = await builder.build(registry);
  assert(prompt.includes('长期记忆'), '有 MEMORY.md → 注入记忆标题');
  assert(prompt.includes('pnpm'), '有 MEMORY.md → 包含记忆内容');
}

async function testBuildContextWithSession() {
  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const meta: SessionMeta = {
    id: 'test-session-abc',
    createdAt: '2026-03-28T10:00:00.000Z',
    updatedAt: '2026-03-28T12:00:00.000Z',
    workDir: '/code/FirmClaw',
    title: '分析代码',
    messageCount: 15,
  };

  const prompt = await builder.build(registry, meta);
  assert(prompt.includes('当前会话'), '有会话元数据 → 注入会话信息');
  assert(prompt.includes('test-session-abc'), '有会话元数据 → 包含会话 ID');
  assert(prompt.includes('/code/FirmClaw'), '有会话元数据 → 包含工作目录');
  assert(prompt.includes('15'), '有会话元数据 → 包含消息数');
}

async function testBuildContextMultipleTools() {
  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));
  registry.register(makeTool('read_file', '读取文件'));
  registry.register(makeTool('write_file', '写入文件'));
  registry.register(makeTool('edit_file', '编辑文件'));

  const prompt = await builder.build(registry);
  assert(prompt.includes('bash'), '多工具 → 包含 bash');
  assert(prompt.includes('read_file'), '多工具 → 包含 read_file');
  assert(prompt.includes('write_file'), '多工具 → 包含 write_file');
  assert(prompt.includes('edit_file'), '多工具 → 包含 edit_file');
}

async function testBuildContextNoSession() {
  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const prompt = await builder.build(registry);
  assert(!prompt.includes('当前会话'), '无会话元数据 → 不注入会话信息');
}

async function testBuildContextAllFiles() {
  const configDir = path.join(testDir, '.firmclaw');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'SOUL.md'), '你是 Rust 专家。', 'utf-8');
  await fs.writeFile(path.join(configDir, 'AGENTS.md'), '- 编译器: 检查代码', 'utf-8');
  await fs.writeFile(path.join(configDir, 'MEMORY.md'), '用户喜欢零成本抽象。', 'utf-8');

  const builder = new ContextBuilder({ workDir: testDir });
  const registry = new ToolRegistry();
  registry.register(makeTool('bash', '执行命令'));

  const meta: SessionMeta = {
    id: 'all-files-test',
    createdAt: '2026-03-28T10:00:00.000Z',
    updatedAt: '2026-03-28T10:00:00.000Z',
    workDir: testDir,
    title: '全部文件测试',
    messageCount: 5,
  };

  const prompt = await builder.build(registry, meta);

  assert(prompt.includes('Rust 专家'), '全部文件 → SOUL.md 注入');
  assert(prompt.includes('编译器'), '全部文件 → AGENTS.md 注入');
  assert(prompt.includes('零成本抽象'), '全部文件 → MEMORY.md 注入');
  assert(prompt.includes('all-files-test'), '全部文件 → 会话信息注入');
  assert(prompt.includes('bash'), '全部文件 → 工具注入');
}

// ═══════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  testDir = path.join(os.tmpdir(), `firmclaw-test-builder-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  console.log(`\n📋 PromptTemplate + ContextBuilder 单元测试`);
  console.log(`   测试目录: ${testDir}\n`);

  console.log('── PromptTemplate ──');
  await testTemplateBasicReplace();
  await testTemplateDefaultValue();
  await testTemplateDefaultValueWhenDefined();
  await testTemplateConditionalTruthy();
  await testTemplateConditionalFalsy();
  await testTemplateConditionalEmptyString();
  await testTemplateMultipleVariables();
  await testTemplateCleanup();

  console.log('\n── ContextBuilder ──');
  await testBuildContextNoWorkspaceFiles();
  await testBuildContextWithSoul();
  await testBuildContextWithAgents();
  await testBuildContextWithMemory();
  await testBuildContextWithSession();
  await testBuildContextMultipleTools();
  await testBuildContextNoSession();
  await testBuildContextAllFiles();

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
