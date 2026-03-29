/**
 * src/cli/renderer.ts
 *
 * CLI 富文本渲染器 —— 在终端中渲染 Markdown、代码块、表格等。
 *
 * 设计要点：
 * - 纯 TypeScript 实现，零外部依赖
 * - 支持 ANSI 颜色（通过 \x1b 转义序列）
 * - 可配置终端宽度、颜色开关
 * - 渲染工具执行信息（tool_start / tool_end 增强）
 *
 * 支持的 Markdown 语法：
 * - # 标题（加粗 + 颜色）
 * - **粗体**
 * - `代码`（反引号，高亮色）
 * - ```代码块```（带语法提示）
 * - - 列表项
 * - > 引用块
 *
 * v5.2: 初始实现
 */

/** 渲染器配置 */
export interface RendererConfig {
  /** 终端宽度（默认 80） */
  width?: number;
  /** 是否启用颜色（默认 true） */
  color?: boolean;
  /** 是否启用 Unicode 图标（默认 true） */
  unicode?: boolean;
}

/** ANSI 颜色码 */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
} as const;

export class Renderer {
  private width: number;
  private color: boolean;
  private unicode: boolean;

  constructor(config?: RendererConfig) {
    this.width = config?.width ?? 80;
    this.color = config?.color ?? true;
    this.unicode = config?.unicode ?? true;
  }

  /**
   * 渲染 Markdown 文本为终端输出
   */
  renderMarkdown(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];

    let inCodeBlock = false;
    let codeBlockLang = '';

    for (const line of lines) {
      // 代码块切换
      if (line.trimStart().startsWith('```')) {
        if (inCodeBlock) {
          // 结束代码块
          result.push(this.c('───', 'dim'));
          inCodeBlock = false;
          codeBlockLang = '';
        } else {
          // 开始代码块
          inCodeBlock = true;
          codeBlockLang = line.trimStart().slice(3).trim();
          const label = codeBlockLang ? ` ${codeBlockLang}` : '';
          result.push(this.c(`┌${label}`, 'cyan'));
        }
        continue;
      }

      // 代码块内容：原样输出，带缩进
      if (inCodeBlock) {
        result.push(`  ${line}`);
        continue;
      }

      // 空行
      if (line.trim() === '') {
        result.push('');
        continue;
      }

      // 标题：# ~ ######
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = headingMatch[2];
        const icon = this.unicode ? '##' : '#';
        result.push('');
        result.push(this.c(`${icon} ${content}`, level <= 2 ? 'bold cyan' : 'bold'));
        result.push('');
        continue;
      }

      // 引用块：> 开头
      if (line.trimStart().startsWith('>')) {
        const content = line.trimStart().slice(1).trim();
        result.push(this.c(`  │ ${content}`, 'dim'));
        continue;
      }

      // 列表项：- 或 * 开头
      if (/^\s*[-*]\s/.test(line)) {
        const content = line.replace(/^\s*[-*]\s/, '');
        const bullet = this.unicode ? '•' : '-';
        result.push(`  ${this.c(bullet, 'cyan')} ${this.renderInline(content)}`);
        continue;
      }

      // 普通段落
      result.push(this.renderInline(line));
    }

    return result.join('\n');
  }

  /**
   * 渲染内联 Markdown（粗体、代码、斜体等）
   */
  renderInline(text: string): string {
    let result = text;

    // 粗体：**text** → ANSI bold
    result = result.replace(/\*\*(.+?)\*\*/g, (_match, content: string) => {
      return this.c(content, 'bold');
    });

    // 行内代码：`text` → ANSI 反引号高亮
    result = result.replace(/`([^`]+)`/g, (_match, content: string) => {
      return this.c(`'${content}'`, 'yellow');
    });

    return result;
  }

  /**
   * 渲染工具执行开始信息
   */
  renderToolStart(toolName: string, args: Record<string, unknown>): string {
    const icon = this.unicode ? '▶' : '>';
    const argsStr = this.truncate(JSON.stringify(args), this.width - 20);
    return `${this.c(`${icon} [${toolName}]`, 'cyan')} ${this.c(argsStr, 'dim')}`;
  }

  /**
   * 渲染工具执行结果
   */
  renderToolEnd(toolName: string, result: string, isError?: boolean): string {
    const icon = isError
      ? (this.unicode ? '✗' : 'X')
      : (this.unicode ? '✓' : 'OK');
    const color = isError ? 'red' : 'green';
    const preview = this.truncate(result, this.width - 20);
    return `  ${this.c(icon, color)} [${toolName}] ${preview}`;
  }

  /**
   * 渲染审批提示
   */
  renderApprovalPrompt(toolName: string, args: Record<string, unknown>, riskLevel: string): string {
    const icon = this.unicode ? '⚠' : '!';
    const level = this.c(`[${riskLevel.toUpperCase()}]`, riskLevel === 'high' ? 'red' : 'yellow');
    return `\n${this.c(`${icon} Approval Required ${level}`, 'bold yellow')}\n` +
      `  Tool: ${toolName}\n` +
      `  Args: ${JSON.stringify(args)}\n` +
      `  Respond: /approve or /deny\n`;
  }

  /**
   * 渲染审计日志条目
   */
  renderAuditEntry(entry: {
    id: string;
    timestamp: string;
    eventType: string;
    toolName?: string;
    riskLevel?: string;
    approvedBy?: string;
    result: string;
  }): string {
    const icon = this.unicode ? '○' : '-';
    const risk = entry.riskLevel ? ` [${entry.riskLevel}]` : '';
    const tool = entry.toolName ? ` ${entry.toolName}` : '';
    const time = entry.timestamp.split('T')[1]?.split('.')[0] ?? entry.timestamp;
    return `${this.c(`${icon} ${entry.id}`, 'gray')} ${this.c(time, 'dim')}${this.c(risk, 'yellow')}${tool} → ${entry.result}`;
  }

  /**
   * 渲染错误信息
   */
  renderError(message: string): string {
    const icon = this.unicode ? '✗' : 'X';
    return `${this.c(`${icon} Error`, 'bold red')} ${message}`;
  }

  /**
   * 渲染系统消息
   */
  renderSystem(message: string): string {
    return this.c(`  [System] ${message}`, 'dim');
  }

  /**
   * 渲染分割线
   */
  renderSeparator(): string {
    return this.c('─'.repeat(Math.min(this.width, 40)), 'dim');
  }

  // ──── 私有方法 ────

  /**
   * 应用 ANSI 颜色（如果启用）
   */
  private c(text: string, style: string): string {
    if (!this.color) return text;

    const parts = style.split(' ');
    let result = '';

    for (const part of parts) {
      result += (ANSI as Record<string, string>)[part] ?? '';
    }

    return `${result}${text}${ANSI.reset}`;
  }

  /**
   * 截断文本到指定长度
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
