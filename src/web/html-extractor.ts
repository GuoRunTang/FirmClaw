/**
 * src/web/html-extractor.ts
 *
 * HTML → 纯文本提取器 — 将网页 HTML 转为干净的文本内容。
 *
 * 设计要点：
 * - 零外部依赖，使用正则提取文本
 * - 去除 script/style/nav/footer/header 等噪音标签
 * - 保留 main/article 标签内的正文内容
 * - 将 br/hr/li/p 等标签转为合适的换行符
 * - 解码 HTML 实体（&amp; &lt; &gt; &quot; &#39; &nbsp;）
 * - 智能截断（默认 15000 字符）
 *
 * v7.0: 初始实现
 */

/** HTML 实体解码表 */
const HTML_ENTITIES: Array<[RegExp, string]> = [
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&#x27;/g, "'"],
  [/&apos;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&mdash;/g, '—'],
  [/&ndash;/g, '–'],
  [/&hellip;/g, '...'],
  [/&#(\d+);/g, (_match, code) => String.fromCharCode(parseInt(code, 10))],
];

/** 需要移除的标签（含内容） */
const REMOVE_TAGS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
  'nav', 'footer', 'header',
];

/** 块级标签（转为换行） */
const BLOCK_TAGS = [
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'tr', 'br', 'hr', 'blockquote', 'pre', 'table',
  'section', 'article', 'aside', 'main',
  'ul', 'ol', 'dl', 'dt', 'dd', 'figcaption',
];

export interface HtmlExtractorOptions {
  /** 最大输出字符数（默认 15000） */
  maxChars?: number;
}

/**
 * 将 HTML 提取为纯文本
 */
export function extractText(html: string, options?: HtmlExtractorOptions): string {
  const maxChars = options?.maxChars ?? 15000;

  // 1. 移除噪音标签（含内容）
  for (const tag of REMOVE_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    html = html.replace(regex, '');
  }

  // 2. 将块级标签替换为换行
  for (const tag of BLOCK_TAGS) {
    const selfClose = tag === 'br' || tag === 'hr';
    if (selfClose) {
      html = html.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '\n');
    } else {
      html = html.replace(new RegExp(`<\\/${tag}>`, 'gi'), '\n');
      html = html.replace(new RegExp(`<${tag}[^>]*>`, 'gi'), '\n');
    }
  }

  // 3. 移除所有剩余 HTML 标签
  html = html.replace(/<[^>]+>/g, '');

  // 4. 解码 HTML 实体
  for (const [regex, replacement] of HTML_ENTITIES) {
    html = html.replace(regex, replacement);
  }

  // 5. 清理空白
  html = html
    .replace(/[ \t]+/g, ' ')      // 多个空白 → 单个空格
    .replace(/\n[ \t]+/g, '\n')   // 行首空白
    .replace(/[ \t]+\n/g, '\n')   // 行尾空白
    .replace(/\n{3,}/g, '\n\n')   // 多个换行 → 两个换行
    // 移除仅有空白/标点的孤立行
    .replace(/^[ \t]*[^\S\n]*[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')   // 再次合并可能产生的新空行
    .trim();

  // 6. 截断
  if (html.length > maxChars) {
    html = html.slice(0, maxChars) + '\n...(truncated)';
  }

  return html;
}
