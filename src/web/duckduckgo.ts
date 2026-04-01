/**
 * src/web/duckduckgo.ts
 *
 * DuckDuckGo 搜索引擎实现 —— 解析 HTML 搜索结果页面。
 *
 * 设计要点：
 * - 免费，无需 API Key
 * - 使用 Node 18+ 原生 fetch API
 * - 解析 HTML 提取搜索结果（标题、摘要、URL）
 * - User-Agent 伪装为浏览器避免被拒绝
 *
 * v7.0: 初始实现
 */

import type { SearchProvider, SearchResult } from './search-provider.js';

/** DuckDuckGo 搜索结果 API URL */
const DDG_SEARCH_URL = 'https://html.duckduckgo.com/html/';

export class DuckDuckGoProvider implements SearchProvider {
  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const url = `${DDG_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  /**
   * 解析 DuckDuckGo HTML 搜索结果
   *
   * DuckDuckGo HTML 版搜索结果的结构：
   * - 每个结果在 <div class="web-result"> 或 <div class="result results_links results_links_deep web-result"> 中
   * - 标题在 <a class="result__a"> 中
   * - 摘要在 <a class="result__snippet"> 中
   * - URL 在 <a class="result__url"> 中，href 格式为 "/l/?uddg=ENCODED_URL&rut=..."
   *
   * 实际解析策略：
   * 1. 用正则提取所有 result__a 链接和 result__snippet 摘要
   * 2. result__a 的 href 中提取实际 URL（uddg 参数解码后为 redirect URL，也可直接使用 ddg 跳转链接）
   * 3. 配对标题和摘要
   */
  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // 提取结果块（每个 web-result 包含标题、URL、摘要）
    const resultBlocks = html.split(/<div[^>]*class="[^"]*result[^"]*web-result[^"]*"[^>]*>/gi);

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      // 提取标题
      const titleMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) continue;
      const title = this.stripHtml(titleMatch[1]);

      // 提取 URL：优先从 result__url 获取，fallback 到 result__a 的 href
      let url = '';
      const urlMatch = block.match(/<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"/i);
      if (urlMatch) {
        url = this.extractUrl(urlMatch[1]);
      } else {
        const hrefMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"/i);
        if (hrefMatch) {
          url = this.extractUrl(hrefMatch[1]);
        }
      }

      if (!url) continue;

      // 提取摘要
      const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      const snippet = snippetMatch ? this.stripHtml(snippetMatch[1]) : '';

      results.push({ title: title.trim(), snippet: snippet.trim(), url });
    }

    return results;
  }

  /**
   * 从 DuckDuckGo 的跳转 URL 中提取实际 URL
   *
   * DuckDuckGo 的 URL 格式通常是：
   * /l/?uddg=https%3A%2F%2Fexample.com&rut=...
   *
   * 我们从 uddg 参数解码得到实际 URL。
   */
  private extractUrl(href: string): string {
    try {
      // 尝试从 uddg 参数提取
      const uddgMatch = href.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        return decodeURIComponent(uddgMatch[1]);
      }
      // 如果已经是正常 URL
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return href;
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * 去除 HTML 标签
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}
