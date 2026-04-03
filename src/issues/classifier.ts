/**
 * src/issues/classifier.ts
 *
 * 问题分类器：基于正则规则自动分类会话中的错误和异常。
 *
 * v1.0: 初始实现 — 33+ 条分类规则，覆盖 11 个一级分类
 */

import type {
  IssueCategory,
  IssueSubCategory,
  IssueSeverity,
  ClassificationRule,
  ClassificationResult,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// 二级分类标签
// ═══════════════════════════════════════════════════════════════

/** 二级细分代码 → 中文标签 */
const SUB_LABELS: Record<string, string> = {
  // ENV
  env_enoent: '文件/目录不存在',
  env_version_mismatch: 'Node.js 版本不匹配',
  env_runtime_error: '运行时异常',
  // DEP
  dep_node_missing: 'npm 依赖缺失',
  dep_python_missing: 'Python 环境缺失',
  dep_pip_install_failed: 'pip 安装失败',
  dep_system_tool_missing: '系统工具缺失',
  // ENCODING
  enc_path_chinese: '中文路径异常',
  enc_output_garbled: '终端输出乱码',
  enc_file_read_error: '文件编码错误',
  // API
  api_call_failed: 'API 调用失败',
  api_timeout: 'API 超时',
  api_rate_limit: 'API 速率限制',
  api_context_overflow: '上下文溢出',
  api_retry_exhausted: '重试耗尽',
  // TOOL
  tool_crash: '工具执行崩溃',
  tool_timeout: '工具执行超时',
  tool_exit_nonzero: '命令非零退出',
  tool_subprocess_failed: '子进程启动失败',
  // PERM
  perm_denied: '权限拒绝',
  perm_path_denied: '路径访问拒绝',
  perm_blacklist: '命令黑名单拦截',
  perm_sensitive: '敏感文件保护',
  // APPROVAL
  approval_rejected: '审批被拒绝',
  approval_timeout: '审批超时',
  // PARAM
  param_parse_error: '参数解析失败',
  param_validation_error: '参数校验失败',
  param_tool_not_found: '工具不存在',
  // AGENT
  agent_loop_stuck: 'Agent 死循环',
  agent_subagent_failed: '子智能体失败',
  agent_wrong_tool: '工具调用异常',
  agent_goal_drift: '目标偏离',
  // CONTEXT
  context_trimmed: 'Token 裁剪',
  context_compacted: '摘要压缩触发',
  context_max_turns: '达到最大轮次',
  // HOOK
  hook_denied: 'Hook 拒绝执行',
};

// ═══════════════════════════════════════════════════════════════
// 默认分类规则（按优先级排序）
// ═══════════════════════════════════════════════════════════════

const DEFAULT_RULES: ClassificationRule[] = [
  // ── 权限问题（高优先级，精确匹配） ──
  { pattern: /Permission denied|EPERM/i, category: 'PERM', subCategory: 'perm_denied', severity: 'error' },
  { pattern: /sensitive.*file|protected.*path/i, category: 'PERM', subCategory: 'perm_sensitive', severity: 'warning' },
  { pattern: /blacklist.*blocked|command.*blocked/i, category: 'PERM', subCategory: 'perm_blacklist', severity: 'warning' },
  { pattern: /path.*outside.*workDir|outside.*workspace/i, category: 'PERM', subCategory: 'perm_path_denied', severity: 'error' },

  // ── 审批问题 ──
  { pattern: /approval.*denied|user.*rejected/i, category: 'APPROVAL', subCategory: 'approval_rejected', severity: 'warning' },
  { pattern: /approval.*timeout|approval.*expired/i, category: 'APPROVAL', subCategory: 'approval_timeout', severity: 'warning' },

  // ── 依赖问题（离线环境重点） ──
  { pattern: /Cannot find module ['"]|MODULE_NOT_FOUND/i, category: 'DEP', subCategory: 'dep_node_missing', severity: 'error' },
  { pattern: /python.*not found|python3.*not found|Python.*No such file/i, category: 'DEP', subCategory: 'dep_python_missing', severity: 'error' },
  { pattern: /pip.*Could not find|pip.*No matching distribution|pip.*error.*offline/i, category: 'DEP', subCategory: 'dep_pip_install_failed', severity: 'error' },
  { pattern: /npm.*ERR!.*network|npm.*ERR!.*ECONNREFUSED|npm.*offline/i, category: 'DEP', subCategory: 'dep_node_missing', severity: 'error' },
  { pattern: /command not found|is not recognized/i, category: 'DEP', subCategory: 'dep_system_tool_missing', severity: 'error' },

  // ── 编码问题（离线环境重点） ──
  { pattern: /UnicodeDecodeError|codec can't decode/i, category: 'ENCODING', subCategory: 'enc_path_chinese', severity: 'warning' },
  { pattern: /not a valid UTF-8|buffer.*encoding|EINVAL.*encoding/i, category: 'ENCODING', subCategory: 'enc_file_read_error', severity: 'warning' },
  { pattern: /garbled|mojibake/i, category: 'ENCODING', subCategory: 'enc_output_garbled', severity: 'warning' },
  { pattern: /[\u4e00-\u9fff].*error|error.*[\u4e00-\u9fff]/i, category: 'ENCODING', subCategory: 'enc_path_chinese', severity: 'warning' },

  // ── LLM API 问题 ──
  { pattern: /LLM API error|LLM.*failed|OpenAI.*error/i, category: 'API', subCategory: 'api_call_failed', severity: 'error' },
  { pattern: /API.*timeout|ETIMEDOUT.*api/i, category: 'API', subCategory: 'api_timeout', severity: 'error' },
  { pattern: /rate.?limit|too many requests|429/i, category: 'API', subCategory: 'api_rate_limit', severity: 'warning' },
  { pattern: /context.*overflow|token.*exceed|maximum.*context/i, category: 'API', subCategory: 'api_context_overflow', severity: 'error' },
  { pattern: /retry.*exhaust|all.*retries.*failed/i, category: 'API', subCategory: 'api_retry_exhausted', severity: 'error' },
  { pattern: /ECONNREFUSED|ENETUNREACH.*api/i, category: 'API', subCategory: 'api_call_failed', severity: 'error' },

  // ── 智能体交互问题（必须在 TOOL 之前，避免 timeout 等词被 TOOL 先匹配） ──
  { pattern: /max turns.*reached|Reached max turns/i, category: 'AGENT', subCategory: 'agent_loop_stuck', severity: 'warning' },
  { pattern: /subagent.*["'].*?["'].*(?:failed|timeout)|subagent\s+"[^"]*"\s+(?:failed|timeout)/i, category: 'AGENT', subCategory: 'agent_subagent_failed', severity: 'error' },

  // ── 工具执行问题 ──
  { pattern: /tool.*crash|Tool execution error|Execution error/i, category: 'TOOL', subCategory: 'tool_crash', severity: 'error' },
  { pattern: /timeout|timed out|TIMEOUT/i, category: 'TOOL', subCategory: 'tool_timeout', severity: 'warning' },
  { pattern: /exit(?:ed)?\s+with?\s+code\s+\d+|non-?zero exit/i, category: 'TOOL', subCategory: 'tool_exit_nonzero', severity: 'warning' },
  { pattern: /spawn.*ENOBIN|subprocess.*failed|failed to spawn/i, category: 'TOOL', subCategory: 'tool_subprocess_failed', severity: 'error' },

  // ── 上下文问题 ──
  { pattern: /trimmed.*messages|context.*trimmed|truncat/i, category: 'CONTEXT', subCategory: 'context_trimmed', severity: 'info' },
  { pattern: /compact.*triggered|summariz/i, category: 'CONTEXT', subCategory: 'context_compacted', severity: 'info' },
  { pattern: /max.*turns|maximum.*rounds/i, category: 'CONTEXT', subCategory: 'context_max_turns', severity: 'warning' },

  // ── 参数问题 ──
  { pattern: /JSON.*parse.*error|invalid.*JSON/i, category: 'PARAM', subCategory: 'param_parse_error', severity: 'warning' },
  { pattern: /validation.*failed|invalid.*param|missing.*param/i, category: 'PARAM', subCategory: 'param_validation_error', severity: 'warning' },
  { pattern: /tool.*not found|unknown.*tool/i, category: 'PARAM', subCategory: 'param_tool_not_found', severity: 'warning' },

  // ── 环境问题 ──
  { pattern: /ENOENT.*no such file|ENOENT.*not found/i, category: 'ENV', subCategory: 'env_enoent', severity: 'error' },
  { pattern: /Node\.js.*version|engine.*not compatible|The engine.*is incompatible/i, category: 'ENV', subCategory: 'env_version_mismatch', severity: 'error' },

  // ── 钩子问题 ──
  { pattern: /Execution denied by hook/i, category: 'HOOK', subCategory: 'hook_denied', severity: 'warning' },
];

// ═══════════════════════════════════════════════════════════════
// Classifier 类
// ═══════════════════════════════════════════════════════════════

export class IssueClassifier {
  private rules: ClassificationRule[];

  constructor(rules?: ClassificationRule[]) {
    this.rules = rules ?? DEFAULT_RULES;
  }

  /**
   * 对一段文本进行分类。
   * 按规则优先级返回第一个匹配结果；无匹配返回 null。
   */
  classify(text: string): ClassificationResult | null {
    for (const rule of this.rules) {
      if (rule.pattern.test(text)) {
        return {
          category: rule.category,
          subCategory: rule.subCategory,
          severity: rule.severity,
          label: SUB_LABELS[rule.subCategory] ?? rule.subCategory,
        };
      }
    }
    return null;
  }

  /**
   * 对一段文本进行分类，返回所有匹配结果（用于多标签场景）。
   */
  classifyAll(text: string): ClassificationResult[] {
    const results: ClassificationResult[] = [];
    for (const rule of this.rules) {
      if (rule.pattern.test(text)) {
        results.push({
          category: rule.category,
          subCategory: rule.subCategory,
          severity: rule.severity,
          label: SUB_LABELS[rule.subCategory] ?? rule.subCategory,
        });
      }
    }
    return results;
  }

  /** 返回当前已加载的规则数量 */
  get ruleCount(): number {
    return this.rules.length;
  }

  /** 添加自定义规则（追加到末尾，优先级低于默认规则） */
  addRule(rule: ClassificationRule): void {
    this.rules.push(rule);
  }

  /** 添加自定义二级标签 */
  static addSubLabel(code: string, label: string): void {
    SUB_LABELS[code] = label;
  }
}
