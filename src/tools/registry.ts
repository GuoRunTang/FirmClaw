/**
 * src/tools/registry.ts
 *
 * 工具注册中心。
 *
 * v1.1: ajv 参数校验 + execute() 方法
 * v1.6: 集成权限策略，execute() 中在校验和调用之间插入权限检查
 * v4.1: 新增 checkPermissionForRisk() 公开方法
 * v4.2: 集成 PromptGuard，execute() 返回前扫描注入
 * v4.5: 集成 HookManager，execute() 前后运行钩子
 */

import Ajv from 'ajv';
import path from 'node:path';
import type { Tool, ToolDefinition, ToolResult } from './types.js';
import type { ToolContext } from './context.js';
import type { PermissionPolicy, PermissionResult } from './permissions.js';
import type { PromptGuard } from '../agent/prompt-guard.js';
import type { HookManager } from './hook-manager.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private validators: Map<string, Ajv.ValidateFunction> = new Map();
  private ajv: Ajv;
  private policy: PermissionPolicy | null = null;
  private promptGuard: PromptGuard | null = null;
  private hookManager: HookManager | null = null;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
  }

  /** 注册一个工具（同时编译参数校验 schema） */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    const validate = this.ajv.compile(tool.parameters);
    this.validators.set(tool.name, validate);
  }

  /** 按名称查找工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册的工具 */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 检查是否存在某个工具 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 设置权限策略 */
  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  /** v4.2: 设置 Prompt Injection 防护 */
  setPromptGuard(guard: PromptGuard): void {
    this.promptGuard = guard;
  }

  /** v4.5: 设置工具钩子管理器 */
  setHookManager(manager: HookManager): void {
    this.hookManager = manager;
  }

  /**
   * 校验工具参数
   */
  validate(name: string, params: Record<string, unknown>): string | null {
    const validate = this.validators.get(name);
    if (!validate) {
      return `Unknown tool: "${name}"`;
    }
    const valid = validate(params);
    if (!valid) {
      const errors = validate.errors?.map(e =>
        `${e.instancePath || '(root)'} ${e.message}`
      ).join('; ');
      return `Parameter validation failed: ${errors}`;
    }
    return null;
  }

  /**
   * 执行工具：参数校验 → before hooks → 权限检查 → 执行 → after hooks → prompt guard
   *
   * v1.6: 在参数校验和执行之间插入权限策略检查
   * v4.5: 在校验后插入 before hooks，执行后插入 after hooks
   */
  async execute(name: string, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // 1. 参数校验
    const validationError = this.validate(name, params);
    if (validationError) {
      return { content: validationError, isError: true };
    }

    // 2. 查找工具
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: "${name}"`, isError: true };
    }

    // 3. v4.5: Before Hooks（可修改参数或拒绝执行）
    if (this.hookManager) {
      const hookCtx = { toolName: name, args: params, toolContext: context };
      const modifiedArgs = await this.hookManager.runBeforeHooks(name, hookCtx);
      if (modifiedArgs === null) {
        return { content: 'Execution denied by hook.', isError: true };
      }
      params = modifiedArgs;
    }

    // 4. 权限检查
    if (this.policy) {
      const permResult = this.checkPermission(name, params, context);
      if (!permResult.allowed) {
        return { content: `Permission denied: ${permResult.reason}`, isError: true };
      }
    }

    // 5. 执行
    const result = await tool.execute(params, context);

    // 6. v4.5: After Hooks（可审计/处理结果）
    if (this.hookManager) {
      const permResult = this.checkPermissionForRisk(name, params, context);
      await this.hookManager.runAfterHooks(name, {
        toolName: name,
        args: params,
        result,
        toolContext: context,
        riskLevel: permResult.riskLevel,
      });
    }

    // 7. v4.2: Prompt Injection 防护
    if (this.promptGuard) {
      const guardResult = this.promptGuard.scan(result.content);
      if (guardResult.suspicious) {
        return {
          content: guardResult.cleanedContent,
          isError: result.isError,
        };
      }
    }

    return result;
  }

  /**
   * v4.1: 获取工具调用的权限检查结果（含风险等级）
   *
   * 供 AgentLoop 在审批流程中使用，不执行实际工具。
   */
  checkPermissionForRisk(
    toolName: string,
    params: Record<string, unknown>,
    context: ToolContext,
  ): PermissionResult {
    if (!this.policy) {
      return { allowed: true, riskLevel: 'low' };
    }
    return this.checkPermission(toolName, params, context);
  }

  /**
   * 根据工具类型调用对应的权限策略方法
   */
  private checkPermission(toolName: string, params: Record<string, unknown>, context: ToolContext): PermissionResult {
    if (!this.policy) {
      return { allowed: true };
    }

    // 文件工具权限检查
    if (['read_file', 'write_file', 'edit_file'].includes(toolName)) {
      const filePath = params.path as string;
      if (!filePath) return { allowed: true }; // 无路径参数时跳过

      const resolved = this.resolvePath(filePath, context.workDir);
      const operation = toolName === 'read_file' ? 'read' : (toolName === 'edit_file' ? 'edit' : 'write');

      if (this.policy.checkFileAccess) {
        return this.policy.checkFileAccess(resolved, operation);
      }
    }

    // bash 命令权限检查
    if (toolName === 'bash') {
      const command = params.command as string;
      if (!command) return { allowed: true };

      if (this.policy.checkCommand) {
        return this.policy.checkCommand(command);
      }
    }

    return { allowed: true };
  }

  /** 解析文件路径（相对 → 绝对） */
  private resolvePath(filePath: string, workDir: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(workDir, filePath);
  }

  /**
   * 将所有工具转换为 OpenAI function calling 格式
   */
  toOpenAITools(): OpenAITool[] {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

/** OpenAI API 要求的工具格式 */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition;
  };
}
