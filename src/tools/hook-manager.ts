/**
 * src/tools/hook-manager.ts
 *
 * 工具执行钩子管理器 — 在工具执行前后插入自定义逻辑。
 *
 * 设计要点：
 * - before hook 可修改参数或拒绝执行
 * - after hook 可处理/审计工具执行结果
 * - 支持通配符 '*' 匹配所有工具
 * - hook 异常不影响主流程（catch & log）
 *
 * v4.5: 初始实现
 */

import type { ToolContext } from './context.js';
import type { RiskLevel } from './permissions.js';

/** 钩子上下文 */
export interface HookContext {
  /** 工具名称 */
  toolName: string;
  /** 工具参数（before hook 可修改） */
  args: Record<string, unknown>;
  /** 工具执行结果（仅 after hook 有值） */
  result?: { content: string; isError?: boolean };
  /** 工具上下文 */
  toolContext: ToolContext;
  /** 风险等级 */
  riskLevel?: RiskLevel;
}

/** Before Hook 返回值 */
export type BeforeHookResult =
  | void                              // 放行（不修改参数）
  | { args: Record<string, unknown> } // 修改参数后放行
  | { deny: true; reason: string };   // 拒绝执行;

/** After Hook 签名 — 可处理结果 */
export type AfterHook = (ctx: HookContext) => void | Promise<void>;

/** 已注册钩子的摘要信息 */
export interface HookInfo {
  /** 工具名（'*' = 全部工具） */
  toolName: string;
  /** 钩子类型 */
  type: 'before' | 'after';
  /** 已注册数量 */
  count: number;
}

export class HookManager {
  private beforeHooks: Map<string, BeforeHook[]> = new Map();
  private afterHooks: Map<string, AfterHook[]> = new Map();

  /**
   * 注册 before hook
   *
   * @param toolName - 工具名（'*' = 全部工具）
   * @param hook - before hook 函数
   */
  registerBefore(toolName: string, hook: BeforeHook): void {
    const hooks = this.beforeHooks.get(toolName) ?? [];
    hooks.push(hook);
    this.beforeHooks.set(toolName, hooks);
  }

  /**
   * 注册 after hook
   *
   * @param toolName - 工具名（'*' = 全部工具）
   * @param hook - after hook 函数
   */
  registerAfter(toolName: string, hook: AfterHook): void {
    const hooks = this.afterHooks.get(toolName) ?? [];
    hooks.push(hook);
    this.afterHooks.set(toolName, hooks);
  }

  /**
   * 运行所有匹配的 before hooks
   *
   * @param toolName - 工具名
   * @param ctx - 钩子上下文
   * @returns 修改后的参数（null 表示被拒绝）
   */
  async runBeforeHooks(toolName: string, ctx: HookContext): Promise<Record<string, unknown> | null> {
    // 先运行通配符 hooks，再运行具体工具 hooks
    const hooks = [
      ...(this.beforeHooks.get('*') ?? []),
      ...(this.beforeHooks.get(toolName) ?? []),
    ];

    let currentArgs = { ...ctx.args };

    for (const hook of hooks) {
      try {
        const result = hook({ ...ctx, args: currentArgs });

        if (result && 'deny' in result && result.deny) {
          return null; // 被拒绝
        }

        if (result && 'args' in result) {
          currentArgs = { ...currentArgs, ...result.args };
        }
      } catch {
        // hook 异常不影响主流程
      }
    }

    return currentArgs;
  }

  /**
   * 运行所有匹配的 after hooks
   *
   * @param toolName - 工具名
   * @param ctx - 钩子上下文（含 result）
   */
  async runAfterHooks(toolName: string, ctx: HookContext): Promise<void> {
    const hooks = [
      ...(this.afterHooks.get('*') ?? []),
      ...(this.afterHooks.get(toolName) ?? []),
    ];

    for (const hook of hooks) {
      try {
        await hook(ctx);
      } catch {
        // hook 异常不影响主流程
      }
    }
  }

  /**
   * 获取已注册的钩子列表
   */
  listHooks(): HookInfo[] {
    const infos: HookInfo[] = [];

    for (const [toolName, hooks] of this.beforeHooks) {
      infos.push({ toolName, type: 'before', count: hooks.length });
    }

    for (const [toolName, hooks] of this.afterHooks) {
      infos.push({ toolName, type: 'after', count: hooks.length });
    }

    return infos;
  }
}
