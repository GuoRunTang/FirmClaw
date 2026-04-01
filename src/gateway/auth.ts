/**
 * src/gateway/auth.ts
 *
 * 简易 Token 认证守卫。
 *
 * 设计要点：
 * - 支持通过 URL 查询参数传递 token：ws://localhost:3000?token=xxx
 * - 未配置 token 时跳过认证（开发模式）
 * - 支持自动生成安全随机 token
 *
 * v5.1: 初始实现
 */

import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export class AuthGuard {
  /** 配置的认证 token（为 null 时跳过认证） */
  private token: string | null;

  constructor(token?: string) {
    this.token = token ?? null;
  }

  /**
   * 验证连接请求的 token
   *
   * token 传递方式（优先级从高到低）：
   * 1. URL 查询参数：ws://localhost:3000?token=xxx
   * 2. Sec-WebSocket-Protocol Header
   *
   * 如果未配置 token（authToken 为空），则跳过认证。
   *
   * @param url - 请求的完整 URL
   * @param headers - HTTP 请求头
   * @returns true = 认证通过或不需要认证，false = 认证失败
   */
  authenticate(url: string, headers: IncomingHttpHeaders): boolean {
    // 未配置 token，跳过认证
    if (!this.token) {
      return true;
    }

    // 从 URL 查询参数提取 token
    const urlToken = this.extractFromUrl(url);
    if (urlToken && this.safeCompare(urlToken, this.token)) {
      return true;
    }

    // 从 Sec-WebSocket-Protocol Header 提取
    const protocol = headers['sec-websocket-protocol'];
    if (typeof protocol === 'string' && this.safeCompare(protocol, this.token)) {
      return true;
    }

    return false;
  }

  /**
   * 是否启用了认证
   */
  isEnabled(): boolean {
    return this.token !== null;
  }

  /**
   * 获取当前 token（用于显示给用户）
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * 生成安全的随机 token（格式：fc_<64位十六进制>）
   */
  static generateToken(): string {
    const bytes = crypto.randomBytes(32);
    return 'fc_' + bytes.toString('hex');
  }

  // ──── 私有方法 ────

  /**
   * 从 URL 查询参数中提取 token
   */
  private extractFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get('token');
    } catch {
      // WebSocket 的 request.url 是相对路径（如 "/?token=xxx"），需要正则回退
      const match = url.match(/[?&]token=([^&]*)/);
      return match ? decodeURIComponent(match[1]) : null;
    }
  }

  /**
   * 恒定时间字符串比较（防止时序攻击）
   */
  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
