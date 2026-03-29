/**
 * src/tests/test-subagent.ts
 *
 * v5.3 子智能体管理器 单元测试
 *
 * 覆盖范围：
 * - SubagentManager: 构造、并发限制、超时、工具继承
 * - createSubagentTool: 参数解析、结果格式化
 */

import { SubagentManager, type SubagentConfig, type SubagentResult } from '../agent/subagent-manager.js';
import { createSubagentTool } from '../tools/subagent.js';
import { ToolRegistry } from '../tools/registry.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架
// ═══════════════════════════════════════════════════════════════

const testQueue: Array<{ name: string; fn: () => Promise<void> }> = [];

function describe(name: string, fn: () => void): void {
  console.error(`\n  ${name}`);
  fn();
}

function it(name: string, fn: () => Promise<void> | void): void {
  testQueue.push({ name, fn: fn as () => Promise<void> });
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
}

function assertIncludes(haystack: string, needle: string, label?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Assertion failed: "${label ?? needle}" not found in "${haystack.substring(0, 100)}"`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock LLMClient
// ═══════════════════════════════════════════════════════════════

class MockLLMClient {
  async chat(): Promise<unknown> {
    return { role: 'assistant', content: 'mock response', tool_calls: [] };
  }
}

type LLMClientLike = import('../llm/client.js').LLMClient;

function mockLLM(): LLMClientLike {
  return new MockLLMClient() as unknown as LLMClientLike;
}

function baseConfig() {
  return { systemPrompt: 'test', maxTurns: 5 };
}

// ═══════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.error('Subagent Manager Tests (v5.3)');
  console.error('==================================');

  describe('SubagentManager 构造', () => {
    it('使用默认配置构造', () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      assert(manager.getActiveCount() === 0, '初始活跃数应为 0');
      assert(manager.getMaxSubagents() === 3, '默认最大并发数应为 3');
    });

    it('自定义并发数和超时', () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig(), {
        maxSubagents: 5,
        defaultTimeoutMs: 60_000,
        defaultMaxTurns: 3,
      });
      assert(manager.getMaxSubagents() === 5, '最大并发数应为 5');
    });
  });

  describe('SubagentConfig 类型', () => {
    it('允许空 allowedTools', () => {
      const config: SubagentConfig = { task: 'hello' };
      assert(config.allowedTools === undefined, '默认无 allowedTools');
      assert(config.maxTurns === undefined, '默认无 maxTurns');
      assert(config.inheritSession === undefined, '默认无 inheritSession');
      assert(config.timeoutMs === undefined, '默认无 timeoutMs');
    });

    it('支持所有可选参数', () => {
      const config: SubagentConfig = {
        task: 'hello',
        allowedTools: ['bash', 'read_file'],
        maxTurns: 10,
        inheritSession: true,
        timeoutMs: 5000,
      };
      assert(config.allowedTools?.length === 2, 'allowedTools 有 2 项');
      assert(config.maxTurns === 10, 'maxTurns 为 10');
      assert(config.inheritSession === true, 'inheritSession 为 true');
      assert(config.timeoutMs === 5000, 'timeoutMs 为 5000');
    });
  });

  describe('createSubagentTool', () => {
    it('创建工具包含正确的名称和描述', () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);
      assert(tool.name === 'subagent', '工具名称应为 subagent');
      assertIncludes(tool.description, 'sub-agent', '描述应包含 sub-agent');
      assert(tool.parameters.type === 'object', '参数类型应为 object');
      assert(tool.parameters.required?.includes('task'), 'task 应为必填');
    });

    it('参数 schema 包含所有字段', () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);
      const props = tool.parameters.properties;
      assert('task' in props, '应有 task 参数');
      assert('allowedTools' in props, '应有 allowedTools 参数');
      assert('maxTurns' in props, '应有 maxTurns 参数');
      assert('inheritSession' in props, '应有 inheritSession 参数');
    });

    it('成功结果返回 completed 状态', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      const mockResult: SubagentResult = {
        subagentId: 'sub_test123',
        task: 'do something',
        text: 'done!',
        turns: 2,
        toolCalls: 1,
        durationMs: 500,
        timedOut: false,
      };

      manager.spawn = async () => mockResult;

      const result = await tool.execute(
        { task: 'do something' },
        { workDir: '/tmp' },
      );

      const parsed = JSON.parse(result.content);
      assert(parsed.status === 'completed', '状态应为 completed');
      assert(parsed.text === 'done!', '文本应为 done!');
      assert(parsed.turns === 2, '轮次应为 2');
      assert(parsed.subagentId === 'sub_test123', 'ID 应匹配');
      assert(result.isError !== true, '不应为错误');
    });

    it('错误结果返回 failed 状态和 isError', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      const mockResult: SubagentResult = {
        subagentId: 'sub_err',
        task: 'fail task',
        text: '',
        turns: 0,
        toolCalls: 0,
        durationMs: 100,
        timedOut: true,
        error: 'timeout after 100ms',
      };

      manager.spawn = async () => mockResult;

      const result = await tool.execute(
        { task: 'fail task' },
        { workDir: '/tmp' },
      );

      assert(result.isError === true, '应为错误');
      const parsed = JSON.parse(result.content);
      assert(parsed.status === 'failed', '状态应为 failed');
      assert(parsed.timedOut === true, '应为超时');
      assertIncludes(parsed.error, 'timeout', '应包含 timeout');
    });

    it('allowedTools 解析逗号分隔字符串', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      let capturedConfig: SubagentConfig | null = null;
      manager.spawn = async (cfg: SubagentConfig) => {
        capturedConfig = cfg;
        return {
          subagentId: 'sub_1', task: cfg.task, text: 'ok',
          turns: 1, toolCalls: 0, durationMs: 100, timedOut: false,
        };
      };

      await tool.execute(
        { task: 'test', allowedTools: 'bash, read_file, write_file' },
        { workDir: '/tmp' },
      );

      assert(capturedConfig !== null, '应捕获配置');
      assert(capturedConfig!.allowedTools?.length === 3, '应有 3 个工具');
      assert(capturedConfig!.allowedTools?.[0] === 'bash', '第一个应为 bash');
      assert(capturedConfig!.allowedTools?.[1] === 'read_file', '第二个应为 read_file');
    });

    it('inheritSession=true 正确传递', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      let capturedConfig: SubagentConfig | null = null;
      manager.spawn = async (cfg: SubagentConfig) => {
        capturedConfig = cfg;
        return {
          subagentId: 'sub_1', task: cfg.task, text: 'ok',
          turns: 1, toolCalls: 0, durationMs: 100, timedOut: false,
        };
      };

      await tool.execute(
        { task: 'test', inheritSession: 'true' },
        { workDir: '/tmp' },
      );

      assert(capturedConfig!.inheritSession === true, 'inheritSession 应为 true');
    });

    it('inheritSession=false 正确传递', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      let capturedConfig: SubagentConfig | null = null;
      manager.spawn = async (cfg: SubagentConfig) => {
        capturedConfig = cfg;
        return {
          subagentId: 'sub_1', task: cfg.task, text: 'ok',
          turns: 1, toolCalls: 0, durationMs: 100, timedOut: false,
        };
      };

      await tool.execute(
        { task: 'test', inheritSession: 'false' },
        { workDir: '/tmp' },
      );

      assert(capturedConfig!.inheritSession === false, 'inheritSession 应为 false');
    });

    it('maxTurns 字符串解析为数字', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const tool = createSubagentTool(manager);

      let capturedConfig: SubagentConfig | null = null;
      manager.spawn = async (cfg: SubagentConfig) => {
        capturedConfig = cfg;
        return {
          subagentId: 'sub_1', task: cfg.task, text: 'ok',
          turns: 1, toolCalls: 0, durationMs: 100, timedOut: false,
        };
      };

      await tool.execute(
        { task: 'test', maxTurns: '20' },
        { workDir: '/tmp' },
      );

      assert(capturedConfig!.maxTurns === 20, 'maxTurns 应为 20');
    });
  });

  describe('SubagentManager spawn 生命周期', () => {
    it('spawn 返回 subagentId 和统计信息', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      const result = await manager.spawn({ task: 'echo hello' });

      assert(typeof result.subagentId === 'string', '应有 subagentId');
      assert(result.subagentId.startsWith('sub_'), 'ID 应以 sub_ 开头');
      assert(result.task === 'echo hello', 'task 应匹配');
      assert(result.text === 'mock response', 'text 应为 mock response');
      assert(result.turns >= 0, 'turns 应 >= 0');
      assert(result.durationMs >= 0, 'durationMs 应 >= 0');
      assert(result.timedOut === false, '不应超时');
      assert(result.error === undefined, '不应有错误');
    });

    it('spawn 后 activeCount 完成后恢复为 0', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig());
      assert(manager.getActiveCount() === 0, '初始应为 0');

      const result = await manager.spawn({ task: 'test' });

      assert(manager.getActiveCount() === 0, '完成后应为 0');
      assert(result.subagentId !== undefined, '应有结果');
    });

    it('并发限制超出时抛出错误', async () => {
      const tools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), tools, baseConfig(), { maxSubagents: 1 });

      // 模拟阻塞状态
      (manager as unknown as { activeCount: number }).activeCount = 1;

      try {
        await manager.spawn({ task: 'blocked' });
        assert(false, '应抛出错误');
      } catch (err: unknown) {
        assertIncludes(
          err instanceof Error ? err.message : String(err),
          'Maximum subagents',
          '应包含最大并发提示',
        );
      } finally {
        (manager as unknown as { activeCount: number }).activeCount = 0;
      }
    });

    it('超时保护返回 timedOut=true', async () => {
      const neverResolveLLM = {
        chat: () => new Promise<unknown>(() => {}),
      } as unknown as LLMClientLike;

      const tools = new ToolRegistry();
      const manager = new SubagentManager(neverResolveLLM, tools, baseConfig());

      const result = await manager.spawn({ task: 'slow', timeoutMs: 50 });

      assert(result.timedOut === true, '应标记为超时');
      assert(result.error !== undefined, '应有错误信息');
      assertIncludes(result.error!, 'timeout', '错误应包含 timeout');
      assert(result.text === '', '超时时 text 应为空');
      assert(manager.getActiveCount() === 0, '超时后应恢复计数');
    });
  });

  describe('工具继承', () => {
    it('allowedTools 为空时继承父智能体全部工具', async () => {
      const parentTools = new ToolRegistry();
      parentTools.register({
        name: 'mock_tool',
        description: 'a mock',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: 'mocked' }),
      });

      const manager = new SubagentManager(mockLLM(), parentTools, baseConfig());
      const result = await manager.spawn({ task: 'test' });
      assert(result.subagentId !== undefined, '应成功执行');
    });

    it('allowedTools 指定不存在的工具时静默忽略', async () => {
      const parentTools = new ToolRegistry();
      const manager = new SubagentManager(mockLLM(), parentTools, baseConfig());
      const result = await manager.spawn({ task: 'test', allowedTools: ['nonexistent'] });
      assert(result.subagentId !== undefined, '应成功执行（即使工具为空）');
    });
  });

  // ──── 运行所有测试 ────
  await runTestQueue();
}

// ═══════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════

async function runTestQueue(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of testQueue) {
    try {
      await fn();
      passed++;
      console.error(`    PASS ${name}`);
    } catch (err: unknown) {
      failed++;
      console.error(`    FAIL ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.error(`\n${'='.repeat(50)}`);
  console.error(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
