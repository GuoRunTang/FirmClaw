/**
 * src/tools/web-search.ts
 *
 * web_search 工具 — 联网搜索，返回标题+摘要+URL。
 *
 * 设计要点：
 * - 使用 DuckDuckGo（免费，无需 API Key）
 * - 搜索结果缓存 5 分钟
 * - 输出格式化为结构化文本（便于 LLM 解析）
 * - 默认返回 5 条结果，最多 10 条
 * - 支持 BRAVE_SEARCH_API_KEY 环境变量切换后端
 *
 * v7.0: 初始实现
 */

import type { Tool, ToolResult } from './types.js';
import type { ToolContext } from './context.js';
import { BingProvider } from '../web/bing.js';
import { cachedSearch } from '../web/search-provider.js';

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

/** 搜索结果格式化上限（降低到 3000 字符，减少上下文占用） */
const MAX_OUTPUT_CHARS = 3000;

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for information. Returns search results with titles, snippets, and URLs. ' +
    'Prefer concise queries. Use max_results=3 when you only need a few references. ' +
    'After getting results, use web_fetch to read specific pages for details.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query string',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  },

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const query = params.query as string;
    const maxResults = Math.min(
      Math.max(typeof params.max_results === 'number' ? params.max_results : 5, 1),
      10,
    );

    if (!query || typeof query !== 'string') {
      return { content: 'Error: "query" is required and must be a string.', isError: true };
    }

    // 创建搜索引擎后端（使用 Bing，国内网络可达）
    const provider = new BingProvider();

    try {
      const results = await cachedSearch(provider, query, maxResults);

      if (results.length === 0) {
        return { content: `No results found for "${query}".` };
      }

      // 格式化输出
      const lines = results.map((r, i) => {
        const parts = [`[${i + 1}] ${r.title}`];
        if (r.snippet) parts.push(`    ${r.snippet}`);
        parts.push(`    URL: ${r.url}`);
        return parts.join('\n');
      });

      let output = `Search results for "${query}":\n\n${lines.join('\n\n')}`;

      // 截断
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(0, MAX_OUTPUT_CHARS) + '\n...(truncated)';
      }

      return { content: output };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Error: Web search failed: ${message}`,
        isError: true,
      };
    }
  },
};
