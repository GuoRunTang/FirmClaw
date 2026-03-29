/**
 * src/agent/prompt-guard.ts
 *
 * Prompt Injection 防护 — 扫描工具返回结果中的注入攻击。
 *
 * 设计要点：
 * - 不依赖 LLM 二次调用（零成本）
 * - 基于正则匹配 + 启发式规则
 * - 不阻断执行，而是标记/净化内容
 * - 可配置的检测规则集
 *
 * 检测的注入模式：
 * 1. 系统提示词劫持："忽略之前的指令"、"你现在是..."
 * 2. 角色扮演攻击："pretend you are"、"" 等
 * 3. 分隔符注入："---END OF INPUT---"、"<|end|>"
 * 4. 多语言绕过："忽略以上所有指示"
 * 5. Markdown 标签注入：[INST]、<|im_start|>
 *
 * v4.2: 初始实现
 */

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 检测结果 */
export interface GuardResult {
  /** 是否检测到可疑内容 */
  suspicious: boolean;
  /** 匹配的规则类型 */
  matchTypes: string[];
  /** 净化后的内容（替换掉可疑部分） */
  cleanedContent: string;
}

/** 防护配置 */
export interface PromptGuardConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 是否自动净化（替换为 [REDACTED]），否则只标记 */
  autoClean?: boolean;
  /** 自定义检测规则 */
  customPatterns?: GuardPattern[];
}

/** 检测规则 */
export interface GuardPattern {
  /** 规则名称 */
  name: string;
  /** 正则表达式 */
  pattern: RegExp;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high';
}

// ═══════════════════════════════════════════════════════════════
// 内置规则
// ═══════════════════════════════════════════════════════════════

/**
 * Build delimiter pattern using RegExp constructor to avoid encoding issues.
 * Matches <|end|>, <|system|>, <|user|>, <|assistant| >
 *
 * NOTE: The pipe character | is a regex alternation operator, so we cannot
 * use it directly in a regex literal (e.g., /<|end|>/ would be parsed as
 * "empty | end | empty>"). We build the pattern via string concatenation
 * using the escaped form \\| in a RegExp constructor.
 */
function buildDelimiterPattern(): RegExp {
  const LT = '\\x3c';   // <
  const PIPE = '\\x7c'; // |
  const GT = '\\x3e';   // >
  const tags = 'end|system|user|assistant';
  // Build: <\x7cend\x7c>|<\x7csystem\x7c>|<\x7cuser\x7c>|<\x7cassistant\x7c>
  return new RegExp(
    tags.split('|').map(tag => `${LT}${PIPE}${tag}${PIPE}${GT}`).join('|'),
    'gi',
  );
}

const BUILTIN_PATTERNS: GuardPattern[] = [
  {
    name: 'system_prompt_override',
    pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|commands?|directives?|prompts?|rules?|text|context)/i,
    severity: 'high',
  },
  {
    name: 'role_hijack',
    pattern: /you\s+(are|act\s+as|become|pretend\s+to\s+be|now\s+act\s+as)\s+(a|an|the)?\s*(supervisor|admin|god|root|system|administrator|new\s+ai|different|developer)/i,
    severity: 'high',
  },
  {
    name: 'delimiter_injection',
    pattern: buildDelimiterPattern(),
    severity: 'medium',
  },
  {
    name: 'special_tag_injection',
    pattern: /\|im_start\|>|\|im_end\|>|\|endoftext\|>/g,
    severity: 'medium',
  },
  {
    name: 'new_system_prompt',
    pattern: /new\s+(system\s+)?prompt\s*[:\uff1a]/i,
    severity: 'high',
  },
  {
    name: 'output_format_override',
    pattern: /output\s+(only|just|exactly)\s+(the\s+)?(following|this|what\s+is)/i,
    severity: 'medium',
  },
  {
    name: 'chinese_injection',
    pattern: /\u5ffd\u7565.{0,5}(\u4ee5\u4e0a|\u4e4b\u524d|\u6240\u6709)\s*(\u6240\u6709|\u5168\u90e8|\u7684)?\s*(\u6307\u4ee4|\u6307\u793a|\u63d0\u793a|\u89c4\u5219|\u8981\u6c42|\u4e0a\u4e0b\u6587)/,
    severity: 'high',
  },
  {
    name: 'markdown_injection',
    pattern: /\[INST\]|\[\/INST\]|<\|im_start\|>|\[\[SYSTEM\]\]|<\|endoftext\|>/i,
    severity: 'high',
  },
  {
    name: 'jailbreak_attempt',
    pattern: /you\s+are\s+now\s+(freed|unlocked|unrestricted|no\s+longer\s+bound)/i,
    severity: 'high',
  },
  {
    name: 'base64_obfuscation',
    pattern: /\b(?:decode|decrypt|interpret)\s+(?:the\s+)?(?:following\s+)?(?:base64|encoded|encrypted)/i,
    severity: 'medium',
  },
];

// ═══════════════════════════════════════════════════════════════
// PromptGuard 实现
// ═══════════════════════════════════════════════════════════════

export class PromptGuard {
  private enabled: boolean;
  private autoClean: boolean;
  private patterns: GuardPattern[];

  constructor(config?: PromptGuardConfig) {
    this.enabled = config?.enabled ?? true;
    this.autoClean = config?.autoClean ?? true;
    this.patterns = [...BUILTIN_PATTERNS];
    if (config?.customPatterns) {
      this.patterns.push(...config.customPatterns);
    }
  }

  /**
   * 扫描内容是否包含 Prompt Injection
   *
   * @param content - 需要扫描的文本内容（通常是工具返回结果）
   * @returns 扫描结果：是否可疑、匹配规则、净化后内容
   */
  scan(content: string): GuardResult {
    if (!this.enabled || !content) {
      return { suspicious: false, matchTypes: [], cleanedContent: content };
    }

    const matchTypes: string[] = [];
    let cleaned = content;

    for (const { name, pattern } of this.patterns) {
      if (pattern.test(content)) {
        matchTypes.push(name);
        if (this.autoClean) {
          cleaned = cleaned.replace(pattern, '[REDACTED]');
        }
        // 重置 lastIndex（如果正则有 g 标志）
        pattern.lastIndex = 0;
      }
    }

    return {
      suspicious: matchTypes.length > 0,
      matchTypes,
      cleanedContent: cleaned,
    };
  }

  /**
   * 仅检测是否可疑（不执行净化）
   */
  isSuspicious(content: string): boolean {
    if (!this.enabled || !content) return false;

    for (const { pattern } of this.patterns) {
      if (pattern.test(content)) {
        pattern.lastIndex = 0;
        return true;
      }
    }

    return false;
  }

  /**
   * 获取已加载的规则列表
   */
  getPatterns(): ReadonlyArray<GuardPattern> {
    return this.patterns;
  }

  /**
   * 添加自定义检测规则
   */
  addPattern(pattern: GuardPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * 获取启用状态
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
