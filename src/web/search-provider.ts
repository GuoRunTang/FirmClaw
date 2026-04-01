/**
 * src/web/search-provider.ts
 *
 * 搜索引擎抽象层 —— 定义搜索接口 + LRU 缓存。
 *
 * 设计要点：
 * - SearchProvider 接口：所有搜索引擎后端统一实现此接口
 * - LRU 缓存：搜索结果 5 分钟、网页内容 10 分钟，避免重复请求
 * - 工厂函数：根据环境变量自动选择搜索引擎后端
 *
 * 支持的后端：
 * - Bing（默认） — 免费，无需 API Key，国内网络可达
 * - DuckDuckGo — 免费，但国内网络可能不可达
 * - Brave Search — 需要 BRAVE_SEARCH_API_KEY
 *
 * v7.0: 初始实现
 */

/** 单条搜索结果 */
export interface SearchResult {
  /** 标题 */
  title: string;
  /** 摘要/描述 */
  snippet: string;
  /** URL */
  url: string;
}

/** 搜索引擎提供者接口 */
export interface SearchProvider {
  /** 执行搜索 */
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

// ═══════════════════════════════════════════════════════════════
// LRU 缓存
// ═══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU: 移到末尾
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    // 淘汰最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 搜索结果缓存
// ═══════════════════════════════════════════════════════════════

/** 搜索结果缓存：5 分钟 TTL，最多 100 条 */
const searchCache = new LRUCache<SearchResult[]>(100);
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

/** 网页内容缓存：10 分钟 TTL，最多 50 条 */
const fetchCache = new LRUCache<string>(50);
const FETCH_CACHE_TTL = 10 * 60 * 1000;

/**
 * 带缓存的搜索
 */
export async function cachedSearch(
  provider: SearchProvider,
  query: string,
  maxResults?: number,
): Promise<SearchResult[]> {
  const cacheKey = `search:${query}:${maxResults ?? 5}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const results = await provider.search(query, maxResults);
  searchCache.set(cacheKey, results, SEARCH_CACHE_TTL);
  return results;
}

/**
 * 带缓存的网页抓取
 */
export async function cachedFetch(url: string, fetcher: () => Promise<string>, maxChars?: number): Promise<string> {
  const cacheKey = `fetch:${url}:${maxChars ?? 15000}`;
  const cached = fetchCache.get(cacheKey);
  if (cached) return cached;

  const content = await fetcher();
  fetchCache.set(cacheKey, content, FETCH_CACHE_TTL);
  return content;
}
