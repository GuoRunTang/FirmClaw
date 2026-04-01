/**
 * src/web/bing.ts
 *
 * Bing 搜索引擎实现 —— 解析 HTML 搜索结果页面。
 *
 * 设计要点：
 * - 免费，无需 API Key
 * - 使用 Node 18+ 原生 fetch API
 * - 解析 HTML 提取搜索结果（标题、摘要、URL）
 * - User-Agent 伪装为浏览器避免被拒绝
 * - 支持中英文搜索
 *
 * v7.0: 初始实现（替代 DuckDuckGo，因国内网络 DDG 不可达）
 */

import type { SearchProvider, SearchResult } from './search-provider.js';

/** Bing 搜索 URL */
const BING_SEARCH_URL = 'https://www.bing.com/search';

export class BingProvider implements SearchProvider {
  async search(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}&setlang=en&cc=us`;

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Bing search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseResults(html, maxResults);
  }

  /**
   * 解析 Bing HTML 搜索结果
   *
   * Bing 搜索结果结构：
   * - 每个结果在 <li class="b_algo"> 中
   * - 标题在 <h2><a href="URL">text</a></h2> 中
   * - 摘要在 <p> 或带 class="b_caption" 的 <div> 中
   * - URL 直接在 <a href="..."> 中（非跳转链接）
   */
  private parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // 提取所有 b_algo 结果块
    const resultBlocks = html.split(/<li[^>]*class="b_algo"[^>]*>/gi);

    for (const block of resultBlocks) {
      if (results.length >= maxResults) break;

      // 提取标题和 URL
      const titleMatch = block.match(
        /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i,
      );
      if (!titleMatch) continue;

      const rawUrl = titleMatch[1];
      const title = this.stripHtml(titleMatch[2]).trim();

      // 过滤非搜索结果（广告等）
      if (!rawUrl || !rawUrl.startsWith('http')) continue;
      if (title.length === 0) continue;

      // 提取摘要
      const snippet =
        this.extractSnippet(block) || '';

      results.push({ title, snippet, url: rawUrl });
    }

    return results;
  }

  /**
   * 从结果块中提取摘要文本
   */
  private extractSnippet(block: string): string {
    // 尝试 <p> 标签中的摘要
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (pMatch) {
      const text = this.stripHtml(pMatch[1]).trim();
      if (text.length > 20) return text;
    }

    // 尝试 b_caption 中的内容
    const captionMatch = block.match(
      /class="b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (captionMatch) {
      const text = this.stripHtml(captionMatch[1]).trim();
      if (text.length > 20) return text;
    }

    return '';
  }

  /**
   * 去除 HTML 标签和解码实体
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&ensp;/g, ' ')
      .replace(/&emsp;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
