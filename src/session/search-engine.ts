/**
 * src/session/search-engine.ts
 *
 * 全文搜索引擎 —— 纯 JS BM25 实现。
 *
 * 功能：
 * - 构建倒排索引
 * - BM25 相关性排序
 * - 跨模块搜索（会话消息、工具结果、记忆条目）
 * - 索引持久化（JSON 格式）
 * - 中英文混合分词（中文 bigram + 英文单词）
 *
 * BM25 算法：
 *   score(D, Q) = Σ IDF(qi) × (f(qi, D) × (k1 + 1)) / (f(qi, D) + k1 × (1 - b + b × |D| / avgdl))
 *
 * 不引入 SQLite / better-sqlite3 等原生依赖，保持零原生依赖原则。
 *
 * v3.3: 初始实现
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryEntry } from './memory-manager.js';

/** 索引文档 */
export interface SearchDocument {
  /** 文档唯一 ID */
  id: string;
  /** 文档来源 */
  source: 'session' | 'memory' | 'tool_result';
  /** 文档文本内容 */
  content: string;
  /** 关联的会话 ID（如果有） */
  sessionId?: string;
  /** 时间戳 */
  timestamp: string;
}

/** 搜索结果 */
export interface SearchResult {
  /** 文档 ID */
  id: string;
  /** BM25 相关性得分 */
  score: number;
  /** 匹配的片段（高亮） */
  snippet: string;
  /** 文档来源 */
  source: SearchDocument['source'];
}

/** 搜索引擎配置 */
export interface SearchEngineConfig {
  /** 索引存储目录，默认 ~/.firmclaw/index */
  indexDir?: string;
  /** BM25 k1 参数（默认 1.5） */
  k1?: number;
  /** BM25 b 参数（默认 0.75） */
  b?: number;
  /** 搜索结果最大数量（默认 10） */
  maxResults?: number;
}

/** 倒排索引结构 */
interface InvertedIndex {
  /** 词 → 文档 ID → 词频 */
  postings: Record<string, Record<string, number>>;
  /** 文档 ID → 文档长度 */
  docLengths: Record<string, number>;
  /** 总文档数 */
  docCount: number;
  /** 所有文档的平均长度 */
  avgDocLength: number;
}

/** 持久化用的索引快照 */
interface IndexSnapshot {
  version: number;
  index: InvertedIndex;
  documents: Array<[string, SearchDocument]>;
}

export class SearchEngine {
  private config: Required<SearchEngineConfig>;
  private index: InvertedIndex;
  private documents: Map<string, SearchDocument>;

  constructor(config?: SearchEngineConfig) {
    this.config = {
      indexDir: config?.indexDir || path.join(
        process.env.HOME || process.env.USERPROFILE || path.join(process.cwd(), '.firmclaw'),
        '.firmclaw',
        'index',
      ),
      k1: config?.k1 ?? 1.5,
      b: config?.b ?? 0.75,
      maxResults: config?.maxResults ?? 10,
    };
    this.index = {
      postings: {},
      docLengths: {},
      docCount: 0,
      avgDocLength: 0,
    };
    this.documents = new Map();
  }

  /** 获取索引统计信息 */
  getStats(): { docCount: number; sources: Record<string, number> } {
    const sources: Record<string, number> = {};
    for (const doc of this.documents.values()) {
      sources[doc.source] = (sources[doc.source] || 0) + 1;
    }
    return { docCount: this.documents.size, sources };
  }

  /**
   * 添加文档到索引
   */
  addDocument(doc: SearchDocument): void {
    // 如果已存在，先删除旧索引
    if (this.documents.has(doc.id)) {
      this.removeDocument(doc.id);
    }

    this.documents.set(doc.id, doc);

    // 分词并构建倒排索引
    const tokens = this.tokenize(doc.content);
    for (const token of tokens) {
      if (!this.index.postings[token]) {
        this.index.postings[token] = {};
      }
      this.index.postings[token][doc.id] = (this.index.postings[token][doc.id] || 0) + 1;
    }

    // 更新文档长度
    this.index.docLengths[doc.id] = tokens.length;
    this.index.docCount = this.documents.size;

    // 重新计算平均文档长度
    this.recalcAvgDocLength();
  }

  /**
   * 批量添加文档
   */
  addDocuments(docs: SearchDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  /**
   * 删除文档
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // 从倒排索引中移除
    const tokens = this.tokenize(doc.content);
    for (const token of tokens) {
      if (this.index.postings[token]) {
        delete this.index.postings[token][id];
        // 如果该词已无文档引用，清理空对象
        if (Object.keys(this.index.postings[token]).length === 0) {
          delete this.index.postings[token];
        }
      }
    }

    // 移除文档长度记录
    delete this.index.docLengths[id];
    this.documents.delete(id);
    this.index.docCount = this.documents.size;

    // 重新计算平均文档长度
    this.recalcAvgDocLength();

    return true;
  }

  /**
   * 执行搜索
   *
   * @param query - 搜索关键词
   * @param limit - 最大结果数（可选，覆盖配置）
   * @returns 按相关性排序的搜索结果
   */
  search(query: string, limit?: number): SearchResult[] {
    const queryTokens = this.tokenize(query);
    const maxResults = limit ?? this.config.maxResults;

    if (queryTokens.length === 0) return [];

    // 为每个文档计算 BM25 得分
    const scores: Map<string, number> = new Map();

    for (const token of queryTokens) {
      const postings = this.index.postings[token];
      if (!postings) continue;

      const idfValue = this.idf(token);

      for (const [docId, tf] of Object.entries(postings)) {
        const docLen = this.index.docLengths[docId] || 1;
        const avgLen = this.index.avgDocLength || 1;

        // BM25 公式
        const numerator = tf * (this.config.k1 + 1);
        const denominator = tf + this.config.k1 * (1 - this.config.b + this.config.b * docLen / avgLen);
        const bm25Score = idfValue * numerator / denominator;

        scores.set(docId, (scores.get(docId) || 0) + bm25Score);
      }
    }

    // 按得分排序
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults);

    // 构建搜索结果
    return sorted.map(([docId, score]) => {
      const doc = this.documents.get(docId)!;
      return {
        id: docId,
        score: Math.round(score * 100) / 100,
        snippet: this.extractSnippet(doc.content, query),
        source: doc.source,
      };
    });
  }

  /**
   * 搜索记忆条目（便捷方法）
   *
   * @param query - 搜索关键词
   * @param entries - 记忆条目列表
   * @param limit - 最大结果数
   * @returns 匹配的记忆 ID 列表
   */
  searchMemory(query: string, entries: MemoryEntry[], limit?: number): string[] {
    // 将记忆条目转为搜索文档
    const docs: SearchDocument[] = entries.map(entry => ({
      id: entry.id,
      source: 'memory' as const,
      content: entry.content,
      timestamp: entry.date,
    }));

    // 临时添加到索引（如果有同名 ID 先删除）
    const existingDocs: SearchDocument[] = [];
    for (const doc of docs) {
      const existing = this.documents.get(doc.id);
      if (existing) {
        existingDocs.push(existing);
      }
      this.addDocument(doc);
    }

    // 执行搜索
    const results = this.search(query, limit);

    // 恢复原有文档
    for (const doc of docs) {
      this.removeDocument(doc.id);
    }
    for (const doc of existingDocs) {
      this.addDocument(doc);
    }

    return results.map(r => r.id);
  }

  /**
   * 持久化索引到磁盘
   */
  async persist(): Promise<void> {
    const dir = this.config.indexDir;
    await fs.mkdir(dir, { recursive: true });

    const snapshot: IndexSnapshot = {
      version: 1,
      index: this.index,
      documents: Array.from(this.documents.entries()),
    };

    const filePath = path.join(dir, 'search-index.json');
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 0), 'utf-8');
  }

  /**
   * 从磁盘加载索引
   */
  async load(): Promise<void> {
    const filePath = path.join(this.config.indexDir, 'search-index.json');

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const snapshot: IndexSnapshot = JSON.parse(content);

      if (snapshot.version !== 1) {
        // 版本不匹配，忽略旧索引
        return;
      }

      this.index = snapshot.index;
      this.documents = new Map(snapshot.documents);
    } catch {
      // 文件不存在或损坏，从空索引开始
      this.index = { postings: {}, docLengths: {}, docCount: 0, avgDocLength: 0 };
      this.documents = new Map();
    }
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.index = { postings: {}, docLengths: {}, docCount: 0, avgDocLength: 0 };
    this.documents = new Map();
  }

  /** 重新计算平均文档长度 */
  private recalcAvgDocLength(): void {
    const lengths = Object.values(this.index.docLengths);
    if (lengths.length === 0) {
      this.index.avgDocLength = 0;
    } else {
      this.index.avgDocLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    }
  }

  /**
   * 分词（支持中英文混合）
   *
   * 策略：
   * 1. 中文：bigram（每两个连续汉字作为一个词）+ 单字（提高召回率）
   * 2. 英文：按空格和标点分割，转小写
   * 3. 合并去重
   */
  private tokenize(text: string): string[] {
    // 提取中文 bigram + 单字
    const chineseBigrams: string[] = [];
    const chineseChars = text.match(/[\u4e00-\u9fff]/g);
    if (chineseChars) {
      // 单字索引
      for (const char of chineseChars) {
        chineseBigrams.push(char);
      }
      // bigram 索引
      for (let i = 0; i < chineseChars.length - 1; i++) {
        chineseBigrams.push(chineseChars[i] + chineseChars[i + 1]);
      }
    }

    // 提取英文单词（转小写）
    const englishWords = text.toLowerCase().match(/[a-z0-9]+/g) || [];

    // 合并去重
    return [...new Set([...chineseBigrams, ...englishWords])];
  }

  /**
   * 计算 IDF（逆文档频率）
   *
   * IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
   *
   * 使用 Okapi BM25 的 IDF 变体，避免负值。
   */
  private idf(term: string): number {
    const postings = this.index.postings[term];
    if (!postings) return 0;

    const n = Object.keys(postings).length; // 包含该词的文档数
    const N = this.index.docCount || 1;     // 总文档数

    return Math.log((N - n + 0.5) / (n + 0.5) + 1);
  }

  /**
   * 提取匹配片段
   *
   * 在文档中找到包含查询关键词的上下文片段。
   */
  private extractSnippet(content: string, query: string): string {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return content.slice(0, 100);

    const contentLower = content.toLowerCase();
    let bestPos = 0;
    let bestMatchCount = 0;

    // 滑动窗口查找最佳匹配位置
    for (let i = 0; i <= contentLower.length - 20; i++) {
      const window = contentLower.slice(i, i + 80);
      let matchCount = 0;
      for (const token of queryTokens) {
        if (window.includes(token)) matchCount++;
      }
      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestPos = i;
      }
    }

    if (bestMatchCount === 0) {
      return content.slice(0, 100) + (content.length > 100 ? '...' : '');
    }

    // 提取片段（带上下文偏移）
    const snippetStart = Math.max(0, bestPos - 20);
    const snippetEnd = Math.min(content.length, bestPos + 100);
    let snippet = content.slice(snippetStart, snippetEnd);

    if (snippetStart > 0) snippet = '...' + snippet;
    if (snippetEnd < content.length) snippet += '...';

    return snippet;
  }
}
