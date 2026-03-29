/**
 * src/agent/approval-gateway.ts
 *
 * 人工审批网关 —— 危险工具调用的暂停/恢复机制。
 *
 * 设计要点：
 * - 通过 Promise + 回调模式实现异步等待
 * - Agent Loop 在 request() 处暂停，CLI 通过 resolve() 恢复
 * - 支持超时自动拒绝（防止永远阻塞）
 * - 支持配置自动批准的工具列表
 *
 * 通信机制：
 *   Agent Loop ──request()──→ 挂起 Promise
 *                              ↓
 *                          emit('approval_requested')
 *                              ↓
 *   CLI ──resolve()────→ resolve Promise
 *                              ↓
 *   Agent Loop 继续
 *
 * v4.1: 初始实现
 */

import crypto from 'node:crypto';
import type { RiskLevel } from '../tools/permissions.js';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 审批请求 */
export interface ApprovalRequest {
  /** 唯一请求 ID */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 风险等级（来自权限策略） */
  riskLevel: RiskLevel;
  /** 请求时间 */
  timestamp: string;
}

/** 审批结果 */
export type ApprovalResult = 'approved' | 'denied' | 'timeout';

/** 审批模式 */
export type ApprovalMode = 'strict' | 'risk-based' | 'auto';

/** 审批网关配置 */
export interface ApprovalGatewayConfig {
  /** 自动批准的工具列表（这些工具不需要人工确认） */
  autoApproveTools?: string[];
  /** 审批超时时间（毫秒，默认 300000 = 5 分钟） */
  timeoutMs?: number;
  /** 审批模式：'strict' 全部需确认 / 'risk-based' 按风险等级 / 'auto' 全部自动 */
  mode?: ApprovalMode;
  /** risk-based 模式下，哪些风险等级需要人工确认（默认 medium, high） */
  requireApprovalFor?: RiskLevel[];
}

// ═══════════════════════════════════════════════════════════════
// 实现
// ═══════════════════════════════════════════════════════════════

export class ApprovalGateway {
  private mode: ApprovalMode;
  private autoApproveTools: Set<string>;
  private timeoutMs: number;
  private requireApprovalFor: Set<RiskLevel>;

  private pendingResolve: ((result: ApprovalResult) => void) | null = null;
  private pendingRequest: ApprovalRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 已处理的审批记录（最近 N 条，用于 /audit） */
  private history: Array<{
    request: ApprovalRequest;
    result: ApprovalResult;
    resolvedAt: string;
  }> = [];
  private readonly maxHistorySize = 100;

  constructor(config?: ApprovalGatewayConfig) {
    this.mode = config?.mode ?? 'risk-based';
    this.autoApproveTools = new Set(config?.autoApproveTools ?? []);
    this.timeoutMs = config?.timeoutMs ?? 300_000;
    this.requireApprovalFor = new Set(config?.requireApprovalFor ?? ['medium', 'high']);
  }

  /**
   * 发起审批请求（可能阻塞直到 resolve 或超时）
   *
   * 自动批准条件：
   * 1. mode 为 'auto' → 全部自动批准
   * 2. 工具在 autoApproveTools 中 → 自动批准
   * 3. mode 为 'risk-based' 且 riskLevel 不在 requireApprovalFor 中 → 自动批准
   *
   * 否则挂起 Promise，等待外部调用 resolve()
   */
  async request(
    toolName: string,
    args: Record<string, unknown>,
    riskLevel: RiskLevel = 'low',
  ): Promise<ApprovalResult> {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      toolName,
      args,
      riskLevel,
      timestamp: new Date().toISOString(),
    };

    // 自动批准判定
    if (this.shouldAutoApprove(toolName, riskLevel)) {
      this.pushHistory(request, 'approved');
      return 'approved';
    }

    // 挂起等待人工审批
    return new Promise<ApprovalResult>((resolve) => {
      this.pendingResolve = resolve;
      this.pendingRequest = request;
      this.startTimer(resolve);
    });
  }

  /**
   * 解决当前挂起的审批请求
   *
   * @returns true = 成功解决，false = 当前无挂起请求
   */
  resolve(result: 'approved' | 'denied'): boolean {
    if (!this.pendingResolve || !this.pendingRequest) {
      return false;
    }

    const resolveFn = this.pendingResolve;
    const request = this.pendingRequest;

    this.clearTimer();
    this.pendingResolve = null;
    this.pendingRequest = null;

    resolveFn(result);
    this.pushHistory(request, result);
    return true;
  }

  /**
   * 获取当前挂起的审批请求（供 CLI 展示详情）
   */
  getPendingRequest(): ApprovalRequest | null {
    return this.pendingRequest;
  }

  /**
   * 获取审批模式
   */
  getMode(): ApprovalMode {
    return this.mode;
  }

  /**
   * 设置审批模式
   */
  setMode(mode: ApprovalMode): void {
    this.mode = mode;
  }

  /**
   * 获取超时时间（毫秒）
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * 获取审批历史（最近 N 条）
   */
  getHistory(): ReadonlyArray<{
    request: ApprovalRequest;
    result: ApprovalResult;
    resolvedAt: string;
  }> {
    return this.history;
  }

  /**
   * 判断当前是否有挂起的请求
   */
  hasPending(): boolean {
    return this.pendingRequest !== null;
  }

  // ──── 私有方法 ────

  /**
   * 判断是否自动批准
   */
  private shouldAutoApprove(toolName: string, riskLevel: RiskLevel): boolean {
    // auto 模式：全部自动
    if (this.mode === 'auto') {
      return true;
    }

    // 工具在自动批准列表中
    if (this.autoApproveTools.has(toolName)) {
      return true;
    }

    // risk-based 模式：风险等级不在需审批列表中
    if (this.mode === 'risk-based' && !this.requireApprovalFor.has(riskLevel)) {
      return true;
    }

    // strict 模式或 risk-based 模式下高风险 → 需要人工确认
    return false;
  }

  /**
   * 启动超时计时器
   */
  private startTimer(resolve: (result: ApprovalResult) => void): void {
    this.timer = setTimeout(() => {
      // 超时自动拒绝
      const request = this.pendingRequest;
      this.pendingResolve = null;
      this.pendingRequest = null;
      this.timer = null;
      resolve('timeout');
      if (request) {
        this.pushHistory(request, 'timeout');
      }
    }, this.timeoutMs);
  }

  /**
   * 清理超时计时器
   */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 记录审批历史
   */
  private pushHistory(request: ApprovalRequest, result: ApprovalResult): void {
    this.history.push({
      request,
      result,
      resolvedAt: new Date().toISOString(),
    });
    // 保留最近 N 条
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }
}
