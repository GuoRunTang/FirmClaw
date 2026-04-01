# FirmClaw Phase 7 设计文档：联网搜索能力

> **状态**: 设计中
> **基于**: v6.1.1 (Phase 1 ~ Phase 6 完成)
> **目标版本**: v7.0.0
> **作者**: AI 设计

---

## 一、Phase 7 目标

**让 FirmClaw 具备联网搜索和网页抓取的能力，从「只能操作本地文件」进化为「可以获取互联网信息」的智能体。**

当前（v6.1.1）系统的核心能力局限于本地文件操作（read/write/edit）和命令执行（bash），缺乏获取互联网实时信息的能力。这导致：

1. **无法回答实时问题** — 如「今天天气如何」「最新的 TypeScript 版本是什么」
2. **无法查阅文档** — 如「Node.js 18 有什么新特性」「React Router v6 怎么用」
3. **无法获取 API 文档** — 智能体在编程辅助时，无法查询第三方库的最新 API

Phase 7 将实现：

1. **`web_search` 工具** — 调用搜索 API 获取搜索结果（标题 + 摘要 + URL）
2. **`web_fetch` 工具** — 抓取并提取网页正文内容，供 LLM 深入阅读
3. **多搜索引擎后端** — 支持 DuckDuckGo（免 API Key）、Brave Search、Tavily、SerpAPI
4. **内容智能提取** — 从 HTML 中提取纯文本，去除导航栏、广告、页脚等噪音
5. **结果缓存与限流** — 避免重复请求，控制 API 调用频率

---

## 二、设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 搜索 API 后端 | **DuckDuckGo（默认） + 可选 Brave/Tavily/SerpAPI** | DuckDuckGo 无需 API Key，本地优先；其他 API 通过环境变量配置即可启用 |
| HTTP 客户端 | **Node.js 原生 `fetch`** | Node 18+ 内置，零依赖；不引入 axios/node-fetch |
| 网页内容提取 | **正则 + 启发式规则** | 不引入 cheerio/jsdom 等重量级 HTML 解析库，保持零原生依赖原则 |
| HTML → Text | **标签剥离 + 智能截断** | 去除 script/style/nav/footer，保留 main/article 内容区 |
| 缓存策略 | **内存 LRU 缓存** | 同一 URL 短时间内不重复抓取，减少网络请求 |
| 输出大小限制 | **搜索结果 5000 字 / 抓取内容 15000 字** | 与现有工具输出截断策略一致（bash 100KB，tool result 500 tokens） |
| 权限策略 | **默认 medium 风险** | 联网涉及外部数据访问，但属于只读操作 |

---

## 三、模块架构

### 3.1 新增文件总览

```
src/
├── tools/
│   ├── web-search.ts          # web_search 工具实现
│   └── web-fetch.ts           # web_fetch 工具实现
├── web/
│   ├── search-provider.ts     # 搜索引擎抽象接口
│   ├── duckduckgo.ts          # DuckDuckGo 搜索实现（免 API Key）
│   ├── brave-search.ts        # Brave Search API 实现
│   ├── tavily.ts              # Tavily Search API 实现
│   └── html-extractor.ts      # HTML → 纯文本提取器
├── tests/
│   ├── test-web-search.ts     # web_search 工具测试
│   ├── test-web-fetch.ts      # web_fetch 工具测试
│   ├── test-html-extractor.ts # HTML 提取器测试
│   └── test-search-providers.ts # 搜索引擎后端测试
```

### 3.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/index.ts` | 导入并注册 `webSearchTool` 和 `webFetchTool` |
| `src/gateway/server.ts` | Gateway 启动时也注册 web 工具 |
| `package.json` | 版本号更新为 7.0.0 |

### 3.3 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   LLM (ReAct 循环)                        │
│                                                          │
│  "帮我查一下 Node.js 18 有什么新特性"                      │
│       ↓                                                  │
│  调用 web_search("Node.js 18 new features")               │
│       ↓                                                  │
│  ┌─────────────────────────────────────────────┐          │
│  │           SearchProvider (抽象接口)          │          │
│  │                                             │          │
│  │  ┌──────────────┐  ┌───────────────────┐   │          │
│  │  │  DuckDuckGo   │  │   Brave Search    │   │          │
│  │  │  (默认/免费)   │  │   (API Key 可选)  │   │          │
│  │  └──────────────┘  └───────────────────┘   │          │
│  └─────────────────────────────────────────────┘          │
│       ↓                                                  │
│  返回搜索结果（标题 + 摘要 + URL）                         │
│       ↓                                                  │
│  LLM: "让我看看第一个结果的详细内容"                        │
│       ↓                                                  │
│  调用 web_fetch("https://nodejs.org/...")                 │
│       ↓                                                  │
│  ┌─────────────────────────────────────────────┐          │
│  │           HtmlExtractor                       │          │
│  │                                             │          │
│  │  1. fetch URL                               │          │
│  │  2. 去除 script/style/nav/footer             │          │
│  │  3. 提取 main/article 正文                   │          │
│  │  4. 纯文本化 + 截断                          │          │
│  └─────────────────────────────────────────────┘          │
│       ↓                                                  │
│  返回网页正文（纯文本）                                    │
│       ↓                                                  │
│  LLM: 综合分析后回复用户                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 四、详细设计

### 4.1 SearchProvider 抽象接口

```typescript
// src/web/search-provider.ts

/** 搜索结果条目 */
export interface SearchResultItem {
  /** 结果标题 */
  title: string;
  /** 结果摘要 */
  snippet: string;
  /** 结果 URL */
  url: string;
}

/** 搜索请求参数 */
export interface SearchRequest {
  /** 搜索关键词 */
  query: string;
  /** 最大返回数量（默认 5） */
  maxResults?: number;
}

/** 搜索引擎提供者接口 */
export interface SearchProvider {
  /** 提供者名称 */
  name: string;
  /** 是否可用（检查 API Key 等配置） */
  isAvailable(): boolean;
  /** 执行搜索 */
  search(request: SearchRequest): Promise<SearchResultItem[]>;
}
```

### 4.2 DuckDuckGo 搜索实现

DuckDuckGo 的 Instant Answer API（`https://api.duckduckgo.com/?q=xxx&format=json`）是免费的，不需要 API Key。但它只返回 Instant Answer，不返回完整搜索结果列表。

**方案**：使用 DuckDuckGo Lite 版本（`https://lite.duckduckgo.com/lite/?q=xxx`），解析 HTML 响应提取搜索结果。

```typescript
// src/web/duckduckgo.ts

export class DuckDuckGoProvider implements SearchProvider {
  name = 'DuckDuckGo';
  
  async search(request: SearchRequest): Promise<SearchResultItem[]> {
    // 1. 构建搜索 URL
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(request.query)}`;
    
    // 2. 发起 HTTP 请求（带浏览器 UA 头）
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    // 3. 解析 HTML 提取结果
    const html = await response.text();
    return this.parseResults(html, request.maxResults ?? 5);
  }
}
```

**注意**：DuckDuckGo Lite 可能会返回验证页面（CAPTCHA），需要做容错处理。如果失败，提示用户配置 Brave Search API。

### 4.3 Brave Search API 实现

```typescript
// src/web/brave-search.ts

export class BraveSearchProvider implements SearchProvider {
  name = 'Brave Search';
  private apiKey: string;
  
  isAvailable(): boolean {
    return !!this.apiKey;
  }
  
  async search(request: SearchRequest): Promise<SearchResultItem[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(request.query)}&count=${request.maxResults ?? 5}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });
    
    const data = await response.json();
    return data.web?.results?.map((r: any) => ({
      title: r.title,
      snippet: r.description,
      url: r.url,
    })) ?? [];
  }
}
```

环境变量：`BRAVE_SEARCH_API_KEY`

### 4.4 web_search 工具

```typescript
// src/tools/web-search.ts

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 
    'Search the web for information. Returns a list of search results with titles, snippets, and URLs. ' +
    'Use this when you need up-to-date information, documentation, or facts not available in local files. ' +
    'For detailed content from a specific URL, use web_fetch instead.',
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
  async execute(params, context): Promise<ToolResult> {
    const query = params.query as string;
    const maxResults = Math.min((params.max_results as number) || 5, 10);
    
    // 自动选择可用的搜索引擎
    const provider = selectProvider();
    if (!provider) {
      return {
        content: 'Error: No web search provider available. Set BRAVE_SEARCH_API_KEY or TAVILY_API_KEY in .env, or DuckDuckGo will be used by default.',
        isError: true,
      };
    }
    
    const results = await provider.search({ query, maxResults });
    
    if (results.length === 0) {
      return { content: 'No search results found.' };
    }
    
    // 格式化输出
    const formatted = results.map((r, i) =>
      `[${i + 1}] ${r.title}\n    ${r.snippet}\n    URL: ${r.url}`
    ).join('\n\n');
    
    return { content: formatted };
  },
};
```

### 4.5 web_fetch 工具

```typescript
// src/tools/web-fetch.ts

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetch and extract the main content from a web page URL. Returns the page text content ' +
    '(navigation, ads, and scripts are stripped). Use this to read the full content of a page ' +
    'found via web_search. Large pages are truncated at ~15000 characters.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from',
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters to return (default: 15000, max: 30000)',
      },
    },
    required: ['url'],
  },
  async execute(params, context): Promise<ToolResult> {
    const url = params.url as string;
    const maxChars = Math.min((params.max_chars as number) || 15000, 30000);
    
    // URL 安全校验
    if (!isValidUrl(url)) {
      return { content: 'Error: Invalid URL format.', isError: true };
    }
    
    // 带缓存和超时的 fetch
    const html = await fetchWithTimeout(url, 15000);
    
    // 提取正文
    const text = extractMainContent(html);
    
    // 截断
    const truncated = text.length > maxChars
      ? text.slice(0, maxChars) + `\n\n[Content truncated: showing ${maxChars} of ${text.length} characters]`
      : text;
    
    return { content: truncated };
  },
};
```

### 4.6 HtmlExtractor 设计

```typescript
// src/web/html-extractor.ts

export function extractMainContent(html: string): string {
  let text = html;
  
  // 1. 去除 script/style 标签及其内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  
  // 2. 去除 head 标签
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  
  // 3. 尝试提取 main/article 区域（如果有）
  const mainMatch = text.match(/<main[\s\S]*?<\/main>/i);
  const articleMatch = text.match(/<article[\s\S]*?<\/article>/i);
  
  if (mainMatch) {
    text = mainMatch[0];
  } else if (articleMatch) {
    text = articleMatch[0];
  }
  
  // 4. 去除导航栏、页脚、侧边栏
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  
  // 5. 去除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  
  // 6. 解码 HTML 实体
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  
  // 7. 压缩空白
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}
```

### 4.7 缓存与限流

```typescript
// src/web/search-provider.ts 内部

class LRUCache<T> {
  private cache = new Map<string, { value: T; expiry: number }>();
  private maxSize: number;
  private ttlMs: number;
  
  get(key: string): T | undefined { /* ... */ }
  set(key: string, value: T): void { /* ... */ }
}

// 搜索结果缓存：5 分钟 TTL
const searchCache = new LRUCache<SearchResultItem[]>(100, 5 * 60 * 1000);

// 网页内容缓存：10 分钟 TTL
const fetchCache = new LRUCache<string>(50, 10 * 60 * 1000);
```

### 4.8 URL 安全校验

```typescript
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // 只允许 http 和 https 协议
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    // 禁止内网地址（防止 SSRF）
    const hostname = parsed.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname === '::1'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
```

### 4.9 权限策略

`web_search` 和 `web_fetch` 属于只读外部访问，风险等级为 `medium`：

```typescript
// 在 DefaultPermissionPolicy.assessCommandRisk 中无需修改
// 因为 web_search/web_fetch 是工具而非 bash 命令
// 但可以在 PermissionPolicy 中新增 checkWebAccess 方法

// 对于 ApprovalGateway：
// - web_search: medium 风险（如果配置了 risk-based 审批模式）
// - web_fetch: medium 风险
```

### 4.10 环境变量配置

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `SEARCH_PROVIDER` | 搜索引擎选择：`duckduckgo` / `brave` / `tavily` | `duckduckgo` |
| `BRAVE_SEARCH_API_KEY` | Brave Search API Key | - |
| `TAVILY_API_KEY` | Tavily Search API Key | - |
| `WEB_SEARCH_MAX_RESULTS` | 默认最大搜索结果数 | `5` |
| `WEB_FETCH_MAX_CHARS` | 默认最大抓取字符数 | `15000` |
| `WEB_FETCH_TIMEOUT_MS` | 网页抓取超时（毫秒） | `15000` |

---

## 五、工具描述（注入 System Prompt）

注册后，ContextBuilder 会自动将工具描述注入 system prompt：

```
## 可用工具
- **web_search**: Search the web for information. Returns a list of search results with titles, snippets, and URLs. Use this when you need up-to-date information, documentation, or facts not available in local files. For detailed content from a specific URL, use web_fetch instead.
    - `query` (必填): The search query string
    - `max_results` (可选): Maximum number of results to return (default: 5, max: 10)
- **web_fetch**: Fetch and extract the main content from a web page URL. Returns the page text content (navigation, ads, and scripts are stripped). Use this to read the full content of a page found via web_search.
    - `url` (必填): The URL to fetch content from
    - `max_chars` (可选): Maximum characters to return (default: 15000, max: 30000)
- **bash**: Execute a shell command. ...
- **read_file**: Read file contents. ...
- **write_file**: Write content to a file. ...
- **edit_file**: Find and replace text in a file. ...
```

---

## 六、实现计划（Task 分解）

### Task 1: SearchProvider 抽象接口 + LRUCache

**Files:**
- Create: `src/web/search-provider.ts`

- [ ] **Step 1: 定义接口和缓存**
- [ ] **Step 2: 编写测试**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 2: DuckDuckGo 搜索实现

**Files:**
- Create: `src/web/duckduckgo.ts`
- Test: `src/tests/test-search-providers.ts`

- [ ] **Step 1: 实现 DuckDuckGoProvider**
- [ ] **Step 2: 编写测试（使用 mock fetch）**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 3: Brave Search 实现

**Files:**
- Create: `src/web/brave-search.ts`

- [ ] **Step 1: 实现 BraveSearchProvider**
- [ ] **Step 2: 编写测试**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 4: HTML 提取器

**Files:**
- Create: `src/web/html-extractor.ts`
- Test: `src/tests/test-html-extractor.ts`

- [ ] **Step 1: 实现 extractMainContent**
- [ ] **Step 2: 编写测试（多场景 HTML 样本）**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 5: web_search 工具

**Files:**
- Create: `src/tools/web-search.ts`
- Test: `src/tests/test-web-search.ts`

- [ ] **Step 1: 实现 web_search 工具**
- [ ] **Step 2: 编写测试（mock provider）**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 6: web_fetch 工具

**Files:**
- Create: `src/tools/web-fetch.ts`
- Test: `src/tests/test-web-fetch.ts`

- [ ] **Step 1: 实现 web_fetch 工具**
- [ ] **Step 2: 编写测试（mock fetch）**
- [ ] **Step 3: 验证测试通过**
- [ ] **Step 4: Commit**

### Task 7: 集成到主程序

**Files:**
- Modify: `src/index.ts`
- Modify: `src/gateway/server.ts`
- Modify: `package.json`

- [ ] **Step 1: 在 index.ts 中导入并注册工具**
- [ ] **Step 2: 在 Gateway 启动时也注册 web 工具**
- [ ] **Step 3: 更新版本号**
- [ ] **Step 4: 端到端测试**
- [ ] **Step 5: Commit**

---

## 七、使用示例

### 场景 1：查询实时信息

```
用户: 今天北京天气怎么样？

LLM 思考: 需要实时信息，调用 web_search
→ web_search({ query: "北京今天天气", max_results: 3 })

搜索结果:
[1] 北京天气预报 - 中国天气网
    北京今日天气：晴，15°C ~ 25°C，北风 3-4 级
    URL: https://www.weather.com.cn/weather/101010100.shtml

[2] 北京 7 天天气预报 - Weather.com
    ...

LLM: 北京今天天气晴朗，气温 15°C ~ 25°C，北风 3-4 级。
```

### 场景 2：查阅技术文档

```
用户: Node.js 18 有哪些新特性？

LLM: web_search({ query: "Node.js 18 new features" })

搜索结果:
[1] Node.js 18: What's New? - Node.js Blog
    ...
    URL: https://nodejs.org/en/blog/release/v18.0.0

LLM: 让我看看 Node.js 官方博客的详细内容。
→ web_fetch({ url: "https://nodejs.org/en/blog/release/v18.0.0" })

[返回 15000 字的页面正文]

LLM: 根据 Node.js 官方博客，v18 的主要新特性包括：
1. **原生 Fetch API** — 无需 node-fetch
2. **Web Streams API** — ...
3. **Test Runner** — 内置测试框架
...
```

### 场景 3：多步搜索 + 深入阅读

```
用户: 帮我对比 React 19 和 Vue 4 的新特性

LLM: 
→ web_search({ query: "React 19 new features 2024" })
→ web_search({ query: "Vue 4 new features 2024" })
→ web_fetch({ url: "https://react.dev/blog/2024/..." })
→ web_fetch({ url: "https://vuejs.org/blog/..." })

LLM: [综合对比表格]
```

---

## 八、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| DuckDuckGo 返回 CAPTCHA | 自动降级提示用户配置 API Key；提供重试逻辑 |
| 搜索 API 频率限制 | 内存缓存 + LRU 淘汰；提示用户配额 |
| 网页抓取超时 | 15 秒硬超时；AbortController 支持 |
| 恶意 URL（SSRF） | URL 白名单（仅 http/https）；禁止内网地址 |
| 大页面占用过多 token | maxChars 截断；与 TokenCounter 裁剪策略协同 |
| HTML 提取不完美 | 启发式规则覆盖主流网站；对提取结果进行清理 |
| 搜索结果不相关 | 返回多条结果让 LLM 自行判断；支持修改 query 重试 |

---

## 九、后续扩展（Phase 7.x）

- **v7.1**: Tavily Search API 后端支持
- **v7.2**: 搜索结果持久化到会话（LLM 可引用之前的搜索）
- **v7.3**: 网页内容缓存到磁盘（避免重复抓取同一页面）
- **v7.4**: `web_screenshot` 工具（需要 headless browser，增加 puppeteer 依赖）
- **v7.5**: 搜索结果自动索引到 SearchEngine（本地搜索 + 网络搜索统一入口）
