/**
 * src/tools/web-fetch.ts
 *
 * web_fetch 工具 — 抓取网页正文，去除 HTML 噪音。
 *
 * 设计要点：
 * - 使用 Node 18+ 原生 fetch API
 * - 解析 HTML 提取正文内容（去除 script/nav/footer 等）
 * - 网页内容缓存 10 分钟
 * - SSRF 防护（禁止 localhost/内网地址，仅允许 http/https）
 * - 智能截断（默认 15000 字符）
 * - 超时保护（默认 15 秒）
 *
 * v7.0: 初始实现
 */

import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';
import { extractText } from '../web/html-extractor.js';
import { cachedFetch } from '../web/search-provider.js';

/** SSRF 防护：禁止访问的地址模式 */
const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::$/,
  /^fe80:/i,
  /^::1$/,
  /^fc\d{2}:/i,
];

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return true;
    return BLOCKED_PATTERNS.some(p => p.test(parsed.hostname));
  } catch {
    return true;
  }
}

/** 内容大小限制（10MB） */
const MAX_CONTENT_BYTES = 10 * 1024 * 1024;

/** 超时时间（毫秒） */
const FETCH_TIMEOUT_MS = 15000;

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetch and extract text content from a web page. Removes HTML noise (scripts, nav, footer) and returns clean text. ' +
    'Use this to read the full content of a page found by web_search. Set max_chars to a smaller value (e.g. 4000) for quick summaries.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the web page to fetch',
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters to extract (default: 8000, max: 30000)',
      },
    },
    required: ['url'],
  },

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const url = params.url as string;
    const maxChars = Math.min(
      Math.max(typeof params.max_chars === 'number' ? params.max_chars : 8000, 1000),
      30000,
    );

    if (!url || typeof url !== 'string') {
      return { content: 'Error: "url" is required and must be a string.', isError: true };
    }

    // SSRF 防护
    if (isBlockedUrl(url)) {
      return {
        content: `Error: Access denied. The URL "${url}" points to a private/blocked address. Only public HTTP/HTTPS URLs are allowed.`,
        isError: true,
      };
    }

    try {
      const content = await cachedFetch(
        url,
        async () => {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            redirect: 'follow',
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type') || '';
          // 仅处理 HTML 内容
          if (
            !contentType.includes('text/html') &&
            !contentType.includes('text/plain') &&
            !contentType.includes('application/xhtml')
          ) {
            throw new Error(`Unsupported content type: ${contentType}`);
          }

          const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
          if (contentLength > MAX_CONTENT_BYTES) {
            throw new Error(`Content too large: ${(contentLength / 1024 / 1024).toFixed(1)} MB (max: 10 MB)`);
          }

          const html = await response.text();
          return extractText(html, { maxChars });
        },
        maxChars,
      );

      if (!content.trim()) {
        return { content: `No extractable text content found at "${url}". The page may be empty or require JavaScript rendering.` };
      }

      const header = `Source: ${url}\nExtracted ${content.length} characters:`;
      return { content: `${header}\n\n${content}` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error: Failed to fetch "${url}": ${message}`,
        isError: true,
      };
    }
  },
};
