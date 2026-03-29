/**
 * src/cli/progress.ts
 *
 * 终端进度指示器 —— 显示工具执行进度和 Agent 状态。
 *
 * 设计要点：
 * - 轻量实现，使用简单的计时器
 * - 工具执行计时
 * - Agent 循环状态显示
 * - 搜索结果统计
 *
 * v5.2: 初始实现
 */

/** Heartbeat 统计信息（从 heartbeat.ts 导入） */
export interface HeartbeatStats {
  status: string;
  ticksCompleted: number;
  ticksRemaining: number;
  totalDurationMs: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  errorCount: number;
}

export class ProgressIndicator {
  private currentTool: string | null = null;
  private startTime: number = 0;

  /**
   * 开始工具执行计时
   */
  startTool(toolName: string): void {
    this.currentTool = toolName;
    this.startTime = Date.now();
  }

  /**
   * 结束工具执行计时
   *
   * @returns 耗时描述字符串（如 "120ms"）
   */
  endTool(): string {
    if (!this.currentTool) return '';
    const duration = Date.now() - this.startTime;
    const name = this.currentTool;
    this.currentTool = null;
    this.startTime = 0;
    return this.formatDuration(duration, name);
  }

  /**
   * 显示 Agent 循环状态
   *
   * @returns 状态字符串（如 "[2/10]"）
   */
  showTurnProgress(currentTurn: number, maxTurns: number): string {
    const bar = this.renderBar(currentTurn, maxTurns, 20);
    return `${bar} [${currentTurn}/${maxTurns}]`;
  }

  /**
   * 显示 Heartbeat 状态
   */
  showHeartbeatStatus(stats: HeartbeatStats): string {
    const parts: string[] = [];

    parts.push(`status: ${stats.status}`);
    parts.push(`ticks: ${stats.ticksCompleted}/${stats.ticksRemaining + stats.ticksCompleted}`);
    parts.push(`uptime: ${this.formatDuration(stats.totalDurationMs)}`);
    parts.push(`errors: ${stats.errorCount}`);

    if (stats.lastTickAt) {
      parts.push(`last: ${stats.lastTickAt.split('T')[1]?.split('.')[0] ?? stats.lastTickAt}`);
    }

    return parts.join(' | ');
  }

  /**
   * 显示搜索状态
   */
  showSearchStatus(query: string, resultCount: number): string {
    const icon = resultCount > 0 ? 'found' : 'no results';
    return `search "${query}" → ${resultCount} ${icon}`;
  }

  /**
   * 显示上下文使用量
   */
  showContextUsage(usedTokens: number, maxTokens: number): string {
    const percent = Math.round((usedTokens / maxTokens) * 100);
    const bar = this.renderBar(usedTokens, maxTokens, 15);
    const color = percent > 80 ? 'HIGH' : percent > 50 ? 'MED' : 'LOW';
    return `${bar} ${usedTokens.toLocaleString()}/${maxTokens.toLocaleString()} tokens (${color})`;
  }

  // ──── 私有方法 ────

  /**
   * 格式化耗时
   */
  private formatDuration(ms: number, context?: string): string {
    if (ms < 1_000) {
      return context ? `${context} ${ms}ms` : `${ms}ms`;
    }
    if (ms < 60_000) {
      return context ? `${context} ${(ms / 1_000).toFixed(1)}s` : `${(ms / 1_000).toFixed(1)}s`;
    }
    return context
      ? `${context} ${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1_000)}s`
      : `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1_000)}s`;
  }

  /**
   * 渲染进度条（纯 ASCII）
   *
   * @param current - 当前进度
   * @param max - 最大值
   * @param width - 进度条宽度（字符数）
   */
  private renderBar(current: number, max: number, width: number): string {
    if (max <= 0) return `[${' '.repeat(width)}]`;

    const filled = Math.min(Math.round((current / max) * width), width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}
