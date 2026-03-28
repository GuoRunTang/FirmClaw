/**
 * src/tools/permissions.ts
 *
 * 权限策略系统 — 工具调用的安全中间件层。
 *
 * 设计理念：
 * - 作为中间件层，不侵入各工具的 execute 实现
 * - registry.execute() 中在校验和调用之间插入权限检查
 * - Phase 5 可扩展为人工审批（Human-in-the-Loop）
 *
 * 三层防护：
 * 1. 路径白名单：文件操作只能在允许的目录内
 * 2. 命令黑名单：bash 不能执行危险命令
 * 3. 敏感文件保护：不能写入 .env 等敏感文件
 */

import path from 'node:path';

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 权限检查结果 */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

/** 权限策略接口 — 工具在 execute 前会经过策略检查 */
export interface PermissionPolicy {
  /** 校验文件操作权限 */
  checkFileAccess?(resolvedPath: string, operation: 'read' | 'write' | 'edit'): PermissionResult;
  /** 校验 bash 命令权限 */
  checkCommand?(command: string): PermissionResult;
}

/** 创建权限策略的配置 */
export interface PermissionConfig {
  /** 允许的目录列表（默认 [workDir]） */
  allowedPaths?: string[];
  /** 额外允许的路径（不限于 allowedPaths） */
  extraAllowedPaths?: string[];
  /** bash 命令黑名单（部分匹配） */
  commandBlacklist?: string[];
  /** 敏感文件保护列表（禁止写入） */
  protectedFiles?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 内置实现：DefaultPermissionPolicy
// ═══════════════════════════════════════════════════════════════

/**
 * 默认权限策略
 *
 * 路径白名单：
 * - 默认允许 workDir 及其所有子目录
 * - 可通过 config.allowedPaths 和 config.extraAllowedPaths 扩展
 * - Windows 系统目录（C:\Windows, C:\Program Files）默认禁止
 *
 * 命令黑名单：
 * - rm -rf /, format, shutdown 等危险命令
 * - 通过部分匹配检测（包含黑名单字符串即拒绝）
 *
 * 敏感文件：
 * - .env、credentials 等文件默认禁止写入
 * - 可通过 config.protectedFiles 自定义
 */
export class DefaultPermissionPolicy implements PermissionPolicy {
  private allowedPaths: string[];
  private extraAllowedPaths: string[];
  private commandBlacklist: string[];
  private protectedFiles: string[];

  constructor(config: PermissionConfig = {}) {
    this.allowedPaths = (config.allowedPaths || []).map(normalizePath);
    this.extraAllowedPaths = (config.extraAllowedPaths || []).map(normalizePath);
    this.commandBlacklist = config.commandBlacklist || DEFAULT_COMMAND_BLACKLIST;
    this.protectedFiles = config.protectedFiles || DEFAULT_PROTECTED_FILES;
  }

  /** 添加允许的路径 */
  addAllowedPath(p: string): void {
    this.allowedPaths.push(normalizePath(p));
  }

  /** 添加额外允许路径（不限于目录包含关系，精确匹配） */
  addExtraAllowedPath(p: string): void {
    this.extraAllowedPaths.push(normalizePath(p));
  }

  /** 校验文件操作权限 */
  checkFileAccess(resolvedPath: string, operation: 'read' | 'write' | 'edit'): PermissionResult {
    const normalized = normalizePath(resolvedPath);

    // 1. 检查是否在系统保护目录内
    for (const sysDir of SYSTEM_PROTECTED_DIRS) {
      if (normalized.startsWith(sysDir)) {
        return { allowed: false, reason: `Access denied: system protected directory "${sysDir}"` };
      }
    }

    // 2. 检查是否在允许的目录内
    let inAllowed = false;
    for (const allowedDir of this.allowedPaths) {
      if (normalized.startsWith(allowedDir)) {
        inAllowed = true;
        break;
      }
    }
    if (!inAllowed) {
      for (const extraPath of this.extraAllowedPaths) {
        if (normalized === extraPath || normalized.startsWith(extraPath + path.sep)) {
          inAllowed = true;
          break;
        }
      }
    }
    if (!inAllowed) {
      return {
        allowed: false,
        reason: `Access denied: "${resolvedPath}" is outside allowed directories. Allowed: ${this.allowedPaths.join(', ') || '(none)'}`,
      };
    }

    // 3. 写入/编辑时检查敏感文件保护
    if (operation === 'write' || operation === 'edit') {
      const fileName = path.basename(resolvedPath).toLowerCase();
      for (const protectedFile of this.protectedFiles) {
        if (fileName === protectedFile.toLowerCase()) {
          return {
            allowed: false,
            reason: `Access denied: cannot write/edit protected file "${fileName}"`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /** 校验 bash 命令权限 */
  checkCommand(command: string): PermissionResult {
    const normalized = command.toLowerCase().trim();

    for (const blocked of this.commandBlacklist) {
      if (normalized.includes(blocked.toLowerCase())) {
        return {
          allowed: false,
          reason: `Command blocked: matches blacklist pattern "${blocked}"`,
        };
      }
    }

    return { allowed: true };
  }
}

// ═══════════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════════

/** 默认 bash 命令黑名单 */
const DEFAULT_COMMAND_BLACKLIST: string[] = [
  'rm -rf /',
  'rm -rf /*',
  'del /f /s /q c:\\',
  'format ',
  'diskpart',
  'shutdown ',
  'taskkill /f /im',
  ':(){ :|:& };:',   // fork bomb
  'mkfs.',
  'dd if=',
];

/** 默认受保护的文件名（写入时拒绝） */
const DEFAULT_PROTECTED_FILES: string[] = [
  '.env',
  '.env.local',
  '.env.production',
  'credentials.json',
  'id_rsa',
  'id_ed25519',
  '.ssh',
];

/** 系统保护目录（Windows） */
const SYSTEM_PROTECTED_DIRS: string[] = [
  normalizePath('C:\\Windows'),
  normalizePath('C:\\Program Files'),
  normalizePath('C:\\Program Files (x86)'),
  normalizePath('C:\\ProgramData'),
];

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/** 统一路径格式（小写、反斜杠） */
function normalizePath(p: string): string {
  return path.resolve(p).toLowerCase().replace(/\\/g, '\\');
}
