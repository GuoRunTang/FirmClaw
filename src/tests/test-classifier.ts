/**
 * src/tests/test-classifier.ts
 *
 * IssueClassifier 单元测试。
 *
 * v1.0: 初始实现
 */

import { IssueClassifier } from '../issues/classifier.js';
import type { ClassificationRule } from '../issues/types.js';

// ═══════════════════════════════════════════════════════════════
// 测试框架
// ═══════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const testQueue: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function describe(name: string, fn: () => void): void { console.log(`\n  ${name}`); fn(); }
function it(name: string, fn: () => Promise<void> | void): void { testQueue.push({ name, fn }); }
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}
function assertEqual<T>(actual: T, expected: T, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
async function runTestQueue(): Promise<void> {
  for (const { name, fn } of testQueue) {
    try { await fn(); passed++; console.log(`    \u2713 ${name}`); }
    catch (err: unknown) { failed++; console.error(`    \u2717 ${name}`); console.error(`      ${err instanceof Error ? err.message : String(err)}`); }
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('IssueClassifier Tests');
  console.log('====================');

  describe('default rules loaded', () => {
    it('has at least 30 rules', () => {
      const c = new IssueClassifier();
      assert(c.ruleCount >= 30, `Expected >= 30 rules, got ${c.ruleCount}`);
    });
  });

  describe('classify: no match', () => {
    it('returns null for normal text', () => {
      const c = new IssueClassifier();
      assertEqual(c.classify('Hello world, everything is fine'), null);
    });
    it('returns null for empty string', () => {
      const c = new IssueClassifier();
      assertEqual(c.classify(''), null);
    });
  });

  // ──── 环境问题 ENV ────
  describe('classify: ENV', () => {
    it('detects ENOENT file not found', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: ENOENT: no such file or directory, open "/tmp/test.txt"');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'ENV');
      assertEqual(r!.subCategory, 'env_enoent');
      assertEqual(r!.severity, 'error');
    });
    it('detects Node.js version mismatch', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: The engine "node" is incompatible with this module. Expected version ">=18"');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'ENV');
      assertEqual(r!.subCategory, 'env_version_mismatch');
    });
  });

  // ──── 依赖问题 DEP ────
  describe('classify: DEP', () => {
    it('detects npm MODULE_NOT_FOUND', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: Cannot find module "lodash"');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'DEP');
      assertEqual(r!.subCategory, 'dep_node_missing');
    });
    it('detects Python not found', () => {
      const c = new IssueClassifier();
      const r = c.classify("python3: not found");
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'DEP');
      assertEqual(r!.subCategory, 'dep_python_missing');
    });
    it('detects pip offline failure', () => {
      const c = new IssueClassifier();
      const r = c.classify('pip install flask ... ERROR: Could not find a version that satisfies the requirement');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'DEP');
      assertEqual(r!.subCategory, 'dep_pip_install_failed');
    });
    it('detects npm ECONNREFUSED', () => {
      const c = new IssueClassifier();
      const r = c.classify('npm ERR! network ECONNREFUSED');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'DEP');
    });
    it('detects command not found', () => {
      const c = new IssueClassifier();
      const r = c.classify("'git' is not recognized as an internal or external command");
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'DEP');
      assertEqual(r!.subCategory, 'dep_system_tool_missing');
    });
  });

  // ──── 编码问题 ENCODING ────
  describe('classify: ENCODING', () => {
    it('detects UnicodeDecodeError', () => {
      const c = new IssueClassifier();
      const r = c.classify("UnicodeDecodeError: 'utf-8' codec can't decode byte");
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'ENCODING');
      assertEqual(r!.subCategory, 'enc_path_chinese');
    });
    it('detects invalid UTF-8', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: not a valid UTF-8 string');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'ENCODING');
      assertEqual(r!.subCategory, 'enc_file_read_error');
    });
    it('detects garbled output', () => {
      const c = new IssueClassifier();
      const r = c.classify('Output appears garbled with mojibake characters');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'ENCODING');
    });
  });

  // ──── LLM API 问题 API ────
  describe('classify: API', () => {
    it('detects LLM API call failure', () => {
      const c = new IssueClassifier();
      const r = c.classify('LLM API error: request failed with status 500');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'API');
      assertEqual(r!.subCategory, 'api_call_failed');
    });
    it('detects API timeout', () => {
      const c = new IssueClassifier();
      const r = c.classify('API timeout after 30000ms');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'API');
      assertEqual(r!.subCategory, 'api_timeout');
    });
    it('detects rate limit', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: rate limit exceeded, too many requests');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'API');
      assertEqual(r!.subCategory, 'api_rate_limit');
    });
    it('detects context overflow', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: context overflow, token count exceeds maximum context length');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'API');
      assertEqual(r!.subCategory, 'api_context_overflow');
    });
    it('detects retry exhausted', () => {
      const c = new IssueClassifier();
      const r = c.classify('All retries exhausted, request failed permanently');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'API');
    });
  });

  // ──── 工具执行问题 TOOL ────
  describe('classify: TOOL', () => {
    it('detects tool crash', () => {
      const c = new IssueClassifier();
      const r = c.classify('Tool execution error: TypeError: Cannot read property "length" of undefined');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'TOOL');
      assertEqual(r!.subCategory, 'tool_crash');
    });
    it('detects tool timeout', () => {
      const c = new IssueClassifier();
      const r = c.classify('Command timed out after 60000ms');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'TOOL');
      assertEqual(r!.subCategory, 'tool_timeout');
    });
    it('detects non-zero exit code', () => {
      const c = new IssueClassifier();
      const r = c.classify('Process exited with code 127');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'TOOL');
      assertEqual(r!.subCategory, 'tool_exit_nonzero');
    });
    it('detects subprocess failure', () => {
      const c = new IssueClassifier();
      const r = c.classify('failed to spawn subprocess: ENOENT');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'TOOL');
      assertEqual(r!.subCategory, 'tool_subprocess_failed');
    });
  });

  // ──── 权限问题 PERM ────
  describe('classify: PERM', () => {
    it('detects permission denied', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: EACCES: permission denied, access "/etc/shadow"');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'PERM');
      assertEqual(r!.subCategory, 'perm_denied');
    });
    it('detects blacklist blocked', () => {
      const c = new IssueClassifier();
      const r = c.classify('Command "rm -rf /" was blocked by command blacklist');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'PERM');
      assertEqual(r!.subCategory, 'perm_blacklist');
    });
  });

  // ──── 审批问题 APPROVAL ────
  describe('classify: APPROVAL', () => {
    it('detects approval rejected', () => {
      const c = new IssueClassifier();
      const r = c.classify('User approval rejected the command execution');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'APPROVAL');
      assertEqual(r!.subCategory, 'approval_rejected');
    });
    it('detects approval timeout', () => {
      const c = new IssueClassifier();
      const r = c.classify('Approval timeout expired after 60s');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'APPROVAL');
      assertEqual(r!.subCategory, 'approval_timeout');
    });
  });

  // ──── 参数问题 PARAM ────
  describe('classify: PARAM', () => {
    it('detects JSON parse error', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: invalid JSON parse: Unexpected token');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'PARAM');
      assertEqual(r!.subCategory, 'param_parse_error');
    });
    it('detects unknown tool', () => {
      const c = new IssueClassifier();
      const r = c.classify('Error: tool "foobar" not found');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'PARAM');
      assertEqual(r!.subCategory, 'param_tool_not_found');
    });
  });

  // ──── 智能体交互问题 AGENT ────
  describe('classify: AGENT', () => {
    it('detects max turns reached', () => {
      const c = new IssueClassifier();
      const r = c.classify('Reached max turns (50), stopping agent loop');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'AGENT');
      assertEqual(r!.subCategory, 'agent_loop_stuck');
    });
    it('detects subagent failure', () => {
      const c = new IssueClassifier();
      const r = c.classify('subagent "researcher" failed: timeout after 120s');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'AGENT');
      assertEqual(r!.subCategory, 'agent_subagent_failed');
    });
  });

  // ──── 上下文问题 CONTEXT ────
  describe('classify: CONTEXT', () => {
    it('detects context trimming', () => {
      const c = new IssueClassifier();
      const r = c.classify('Trimmed 5 oldest messages to fit context window');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'CONTEXT');
      assertEqual(r!.subCategory, 'context_trimmed');
      assertEqual(r!.severity, 'info');
    });
    it('detects compaction', () => {
      const c = new IssueClassifier();
      const r = c.classify('Compact triggered: summarizing conversation history');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'CONTEXT');
      assertEqual(r!.subCategory, 'context_compacted');
    });
  });

  // ──── 钩子问题 HOOK ────
  describe('classify: HOOK', () => {
    it('detects hook denied', () => {
      const c = new IssueClassifier();
      const r = c.classify('Execution denied by hook: security check failed');
      assert(r !== null, 'should match');
      assertEqual(r!.category, 'HOOK');
      assertEqual(r!.subCategory, 'hook_denied');
    });
  });

  // ──── 自定义规则 ────
  describe('custom rules', () => {
    it('addRule appends custom rule', () => {
      const c = new IssueClassifier();
      const initialCount = c.ruleCount;
      c.addRule({
        pattern: /CUSTOM_ERROR_PATTERN/i,
        category: 'ENV',
        subCategory: 'custom',
        severity: 'info',
      });
      assertEqual(c.ruleCount, initialCount + 1);
      const r = c.classify('Something CUSTOM_ERROR_PATTERN appeared');
      assert(r !== null, 'custom rule should match');
      assertEqual(r!.category, 'ENV');
      assertEqual(r!.subCategory, 'custom');
    });
    it('custom rule has lower priority than defaults', () => {
      const c = new IssueClassifier();
      // Tool crash pattern exists in defaults as TOOL, add custom as ENV
      c.addRule({
        pattern: /Tool execution error/i,
        category: 'ENV',
        subCategory: 'custom_tool_error',
        severity: 'info',
      });
      const r = c.classify('Tool execution error: something broke');
      assert(r !== null, 'should match');
      // Default rule matches first (higher priority)
      assertEqual(r!.category, 'TOOL', 'default TOOL rule should win');
      assertEqual(r!.subCategory, 'tool_crash');
    });
  });

  // ──── classifyAll ────
  describe('classifyAll', () => {
    it('returns multiple matches', () => {
      const c = new IssueClassifier();
      const results = c.classifyAll('Permission denied: ENOENT no such file, exit code 1');
      assert(results.length >= 2, `Expected >= 2 matches, got ${results.length}`);
    });
    it('returns empty for no match', () => {
      const c = new IssueClassifier();
      const results = c.classifyAll('Everything is perfectly fine');
      assertEqual(results.length, 0);
    });
  });
}

// ──── 运行 ────

runTests().then(async () => {
  await runTestQueue();
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
