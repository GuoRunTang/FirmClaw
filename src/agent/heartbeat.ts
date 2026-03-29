/**
 * src/agent/heartbeat.ts
 *
 * Heartbeat 心跳管理器 — 让智能体自主执行任务。
 *
 * 设计要点：
 * - 不直接依赖 AgentLoop，通过 onTick 回调组合
 * - setInterval 定时触发任务
 * - 支持最多 N 次循环后自动停止
 * - 错误不中断心跳，记录错误继续下一轮
 * - 支持 start / stop / pause / resume 生命周期
 *
 * v4.4: 初始实现
 */

/** 心跳配置 */
export interface HeartbeatConfig {
  /** 任务 prompt（智能体每轮执行的内容） */
  taskPrompt: string;
  /** 循环间隔（毫秒，默认 60000 = 1 分钟） */
  intervalMs?: number;
  /** 最大循环次数（0 = 无限，默认 10） */
  maxTicks?: number;
}

/** 心跳状态 */
export type HeartbeatStatus = 'idle' | 'running' | 'paused' | 'stopped';

/** 心跳统计信息 */
export interface HeartbeatStats {
  /** 当前状态 */
  status: HeartbeatStatus;
  /** 已完成的循环次数 */
  ticksCompleted: number;
  /** 剩余循环次数（maxTicks=0 时为 Infinity） */
  ticksRemaining: number;
  /** 总运行时长（毫秒） */
  totalDurationMs: number;
  /** 上次循环时间（ISO 8601） */
  lastTickAt: string | null;
  /** 下次循环预计时间（ISO 8601） */
  nextTickAt: string | null;
  /** 累计错误次数 */
  errorCount: number;
}

export class Heartbeat {
  private taskPrompt: string;
  private intervalMs: number;
  private maxTicks: number;
  private onTick: (prompt: string) => Promise<void>;

  private timer: ReturnType<typeof setInterval> | null = null;
  private status: HeartbeatStatus = 'idle';
  private ticksCompleted = 0;
  private errors = 0;
  private startTime: number | null = null;
  private lastTickAt: string | null = null;

  constructor(config: HeartbeatConfig, onTick: (prompt: string) => Promise<void>) {
    this.taskPrompt = config.taskPrompt;
    this.intervalMs = config.intervalMs ?? 60000;
    this.maxTicks = config.maxTicks ?? 10;
    this.onTick = onTick;
  }

  /**
   * 启动心跳
   *
   * 如果已在运行或已停止，调用无效。
   */
  start(): void {
    if (this.status === 'running') return;
    if (this.status === 'stopped') return;

    this.status = 'running';
    this.startTime = this.startTime ?? Date.now();

    this.scheduleNext();
  }

  /**
   * 停止心跳（不可恢复，需创建新实例）
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status = 'stopped';
  }

  /**
   * 暂停心跳（可恢复）
   */
  pause(): void {
    if (this.status !== 'running') return;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status = 'paused';
  }

  /**
   * 恢复心跳
   */
  resume(): void {
    if (this.status !== 'paused') return;

    this.status = 'running';
    this.scheduleNext();
  }

  /**
   * 获取当前统计信息
   */
  getStats(): HeartbeatStats {
    const now = Date.now();
    const totalDurationMs = this.startTime ? now - this.startTime : 0;

    let nextTickAt: string | null = null;
    if (this.status === 'running' && this.lastTickAt) {
      const lastTime = new Date(this.lastTickAt).getTime();
      nextTickAt = new Date(lastTime + this.intervalMs).toISOString();
    }

    return {
      status: this.status,
      ticksCompleted: this.ticksCompleted,
      ticksRemaining: this.maxTicks > 0 ? Math.max(0, this.maxTicks - this.ticksCompleted) : 0,
      totalDurationMs,
      lastTickAt: this.lastTickAt,
      nextTickAt,
      errorCount: this.errors,
    };
  }

  /**
   * 更新任务 prompt（下次 tick 生效）
   */
  updatePrompt(prompt: string): void {
    this.taskPrompt = prompt;
  }

  /**
   * 获取当前任务 prompt
   */
  getTaskPrompt(): string {
    return this.taskPrompt;
  }

  /**
   * 获取当前状态
   */
  getStatus(): HeartbeatStatus {
    return this.status;
  }

  /** 安排下一次定时器 */
  private scheduleNext(): void {
    this.timer = setInterval(() => {
      this.tick().catch(() => {
        // Errors are handled inside tick()
      });
    }, this.intervalMs);
  }

  /** 执行一轮心跳 */
  private async tick(): Promise<void> {
    // 检查是否达到最大次数
    if (this.maxTicks > 0 && this.ticksCompleted >= this.maxTicks) {
      this.stop();
      return;
    }

    try {
      await this.onTick(this.taskPrompt);
      this.ticksCompleted++;
      this.lastTickAt = new Date().toISOString();
    } catch (err) {
      this.errors++;
      this.ticksCompleted++;
      this.lastTickAt = new Date().toISOString();
      // 错误不中断心跳，继续下一轮
    }
  }
}
