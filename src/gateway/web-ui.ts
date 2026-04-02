/**
 * src/gateway/web-ui.ts
 *
 * Web UI 内嵌 HTML —— 通过 WebSocket 连接到 GatewayServer 的单页面聊天界面。
 *
 * 设计要点：
 * - 纯静态 HTML/CSS/JS，无外部依赖
 * - 自动从 URL 参数读取 token
 * - 使用 JSON-RPC 2.0 协议与后端通信
 * - 支持会话列表、消息历史、Markdown 渲染
 *
 * v5.4: 初始实现
 */

const RENDER_MARKDOWN_JS = [
  'function renderMarkdown(text) {',
  '  var html = escapeHtml(text);',
  '  var BT = String.fromCharCode(96);',
  '  html = html.replace(new RegExp(BT+BT+BT+"(\\\\w*)\\\\n?([\\\\s\\\\S]*?)"+BT+BT+BT, "g"), function(match, lang, code) {',
  '    var langLabel = lang ? \'<span style="color:#8b949e;font-size:11px;position:absolute;top:4px;left:12px">\' + lang + \'</span>\' : \'\';',
  '    var id = \'code-\' + Date.now() + \'-\' + Math.random().toString(36).slice(2,6);',
  '    return \'<div class="code-block" style="position:relative"><div class="copy-btn" onclick="copyCode(this)">Copy</div>\' + langLabel + \'<pre><code id="\' + id + \'">\' + code + \'</code></pre></div>\';',
  '  });',
  '  html = html.replace(new RegExp(BT+"([^"+BT+"]+?)"+BT, "g"), "<code>$1</code>");',
  '  html = html.replace(/\\*\\*([^\\*]+?)\\*\\*/g, "<strong>$1</strong>");',
  '  html = html.replace(/\\*([^\\*]+?)\\*/g, "<em>$1</em>");',
  '  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");',
  '  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");',
  '  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");',
  '  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");',
  '  html = html.replace(/(^- .+(\\n|$))+/gm, function(block) {',
  '    var items = block.trim().split("\\n").map(function(line) { return "<li>" + line.replace(/^- /, "") + "</li>"; }).join("");',
  '    return "<ul>" + items + "</ul>";',
  '  });',
  '  html = html.replace(/(^\\d+\\. .+(\\n|$))+/gm, function(block) {',
  '    var items = block.trim().split("\\n").map(function(line) { return "<li>" + line.replace(/^\\d+\\. /, "") + "</li>"; }).join("");',
  '    return "<ol>" + items + "</ol>";',
  '  });',
  '  html = html.replace(/^---+$/gm, "<hr>");',
  '  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");',
  '  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, \'<a href="$2" target="_blank" rel="noopener">$1</a>\');',
  '  html = html.replace(/\\n\\n+/g, "</p><p>");',
  '  html = html.replace(/\\n/g, "<br>");',
  '  html = "<p>" + html + "</p>";',
  '  html = html.replace(/<p>\\s*<(h[1-4]|ul|ol|pre|blockquote|hr|div)/g, "<$1");',
  '  html = html.replace(/<\\/(h[1-4]|ul|ol|pre|blockquote|hr|div)>\\s*<\\/p>/g, "</$1>");',
  '  html = html.replace(/<p>\\s*<\\/p>/g, "");',
  '  return html;',
  '}',
].join('\n');

export function getWebUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FirmClaw</title>
<style>
/* === Theme Variables === */
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --bg-code: #1c2128;
  --border-default: #30363d;
  --border-muted: #21262d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --accent-blue: #1f6feb;
  --accent-blue-hover: #388bfd;
  --accent-green: #3fb950;
  --accent-red: #f85149;
  --accent-green-btn: #238636;
  --accent-green-btn-hover: #2ea043;
  --text-link: #58a6ff;
  --text-strong: #e6edf3;
  --text-em: #d2a8ff;
  --text-code: #ff7b72;
  --avatar-user: #1f6feb;
  --avatar-assistant: #238636;
  --avatar-system: #30363d;
  --avatar-tool: #30363d;
  --scrollbar-thumb: #30363d;
  --scrollbar-thumb-hover: #484f58;
}
[data-theme="light"] {
  --bg-primary: #ffffff;
  --bg-secondary: #f6f8fa;
  --bg-tertiary: #eaeef2;
  --bg-code: #f6f8fa;
  --border-default: #d0d7de;
  --border-muted: #eaeef2;
  --text-primary: #1f2328;
  --text-secondary: #656d76;
  --text-muted: #8c959f;
  --accent-blue: #0969da;
  --accent-blue-hover: #0550ae;
  --accent-green: #1a7f37;
  --accent-red: #cf222e;
  --accent-green-btn: #1a7f37;
  --accent-green-btn-hover: #116329;
  --text-link: #0969da;
  --text-strong: #1f2328;
  --text-em: #8250df;
  --text-code: #cf222e;
  --avatar-user: #0969da;
  --avatar-assistant: #1a7f37;
  --avatar-system: #d0d7de;
  --avatar-tool: #d0d7de;
  --scrollbar-thumb: #d0d7de;
  --scrollbar-thumb-hover: #8c959f;
}

/* === Base === */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif; background: var(--bg-primary); color: var(--text-primary); height: 100vh; display: flex; flex-direction: column; }

/* Header */
.header { background: var(--bg-secondary); border-bottom: 1px solid var(--border-default); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 16px; color: var(--text-link); letter-spacing: 0.5px; }
.header .status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.header .status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-red); transition: background 0.3s; }
.header .status .dot.connected { background: var(--accent-green); box-shadow: 0 0 6px var(--accent-green)66; }

/* Layout */
.main { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 260px; min-width: 260px; background: var(--bg-secondary); border-right: 1px solid var(--border-default); display: flex; flex-direction: column; }
.sidebar .new-session { padding: 12px; border-bottom: 1px solid var(--border-default); }
.sidebar .new-session button { width: 100%; padding: 8px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-default); border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.15s; }
.sidebar .new-session button:hover { background: var(--border-default); border-color: var(--text-muted); }
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 2px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.15s; }
.session-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.session-item.active { background: var(--accent-blue)22; color: var(--text-link); font-weight: 500; }
.session-item-inner { display: flex; align-items: center; justify-content: space-between; }
.session-item-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-item-delete { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1; opacity: 0; transition: opacity 0.15s, color 0.15s; flex-shrink: 0; }
.session-item:hover .session-item-delete { opacity: 1; }
.session-item-delete:hover { color: var(--accent-red); }

/* Chat Area */
.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.messages { flex: 1; overflow-y: auto; padding: 24px 0; }
.messages-inner { max-width: 820px; margin: 0 auto; padding: 0 24px; }

/* Message row: avatar + content */
.message { display: flex; gap: 12px; margin-bottom: 20px; align-items: flex-start; }
.message.user { flex-direction: row-reverse; }
.message-avatar { width: 32px; height: 32px; min-width: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
.message.user .message-avatar { background: var(--avatar-user); color: #fff; }
.message.assistant .message-avatar { background: var(--avatar-assistant); color: #fff; }
.message.system .message-avatar { background: var(--avatar-system); color: var(--text-secondary); font-size: 12px; }
.message.tool .message-avatar { background: var(--avatar-tool); color: var(--text-link); font-size: 12px; }

.message-content { min-width: 0; max-width: 680px; }
.message.user .message-content { text-align: right; }

.message-role { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.message.user .message-role { text-align: right; }

.message .bubble { display: inline-block; padding: 10px 16px; border-radius: 12px; font-size: 14px; line-height: 1.7; text-align: left; }
.message.user .bubble { background: var(--accent-blue); color: #fff; border-bottom-right-radius: 4px; }
.message.assistant .bubble { background: var(--bg-secondary); border: 1px solid var(--border-default); border-bottom-left-radius: 4px; }
.message.system .bubble { background: var(--bg-primary); border: 1px dashed var(--border-default); color: var(--text-secondary); font-size: 12px; }
.message.tool .bubble { background: var(--bg-primary); border: 1px solid var(--border-default); font-size: 13px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; border-left: 3px solid var(--text-link); border-radius: 6px; border-bottom-left-radius: 0; }

/* Tool */
.tool-name { color: var(--text-link); font-weight: 600; }
.tool-result { color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; margin-top: 4px; }

/* Thinking */
.thinking { color: var(--text-secondary); font-style: italic; padding: 4px 0; }
.thinking::after { content: '...'; animation: blink 1s steps(3) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Input */
.input-area { padding: 16px 24px; border-top: 1px solid var(--border-default); background: var(--bg-primary); }
.input-row { max-width: 820px; margin: 0 auto; display: flex; gap: 8px; }
.input-row textarea { flex: 1; padding: 10px 14px; background: var(--bg-secondary); border: 1px solid var(--border-default); border-radius: 8px; color: var(--text-primary); font-size: 14px; resize: none; font-family: inherit; min-height: 42px; max-height: 200px; transition: border-color 0.2s; }
.input-row textarea:focus { outline: none; border-color: var(--text-link); box-shadow: 0 0 0 2px var(--text-link)22; }
.input-row textarea::placeholder { color: var(--text-muted); }
.input-row button { padding: 10px 20px; background: var(--accent-blue); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.15s; }
.input-row button:hover { background: var(--accent-blue-hover); }
.input-row button:disabled { background: var(--bg-tertiary); color: var(--text-muted); cursor: not-allowed; }

/* Markdown rendering */
.md-content h1, .md-content h2, .md-content h3, .md-content h4 { margin: 16px 0 8px; color: var(--text-strong); font-weight: 600; }
.md-content h1 { font-size: 1.35em; border-bottom: 1px solid var(--border-default); padding-bottom: 6px; }
.md-content h2 { font-size: 1.2em; border-bottom: 1px solid var(--border-muted); padding-bottom: 4px; }
.md-content h3 { font-size: 1.1em; }
.md-content p { margin: 8px 0; }
.md-content strong { color: var(--text-strong); font-weight: 600; }
.md-content em { color: var(--text-em); }
.md-content code { background: var(--bg-code); padding: 2px 6px; border-radius: 4px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 0.88em; color: var(--text-code); }
.md-content pre { background: var(--bg-primary); padding: 14px 16px; border-radius: 8px; overflow-x: auto; margin: 10px 0; border: 1px solid var(--border-muted); position: relative; }
.md-content pre code { background: none; padding: 0; color: var(--text-primary); font-size: 0.85em; }
.md-content ul, .md-content ol { padding-left: 24px; margin: 8px 0; }
.md-content li { margin: 4px 0; }
.md-content li::marker { color: var(--text-link); }
.md-content ol li::marker { color: var(--text-link); font-weight: 600; }
.md-content blockquote { border-left: 3px solid var(--text-link); padding: 8px 16px; color: var(--text-secondary); margin: 10px 0; background: var(--bg-secondary); border-radius: 0 6px 6px 0; }
.md-content a { color: var(--text-link); text-decoration: none; }
.md-content a:hover { text-decoration: underline; }
.md-content hr { border: none; border-top: 1px solid var(--border-default); margin: 16px 0; }
.md-content table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 13px; }
.md-content th, .md-content td { border: 1px solid var(--border-default); padding: 8px 12px; text-align: left; }
.md-content th { background: var(--bg-secondary); font-weight: 600; color: var(--text-strong); }
.md-content tr:hover { background: var(--bg-secondary)44; }

/* Code block copy button */
.code-block { position: relative; }
.code-block .copy-btn { position: absolute; top: 6px; right: 6px; padding: 3px 8px; background: var(--bg-tertiary); border: 1px solid var(--border-default); border-radius: 4px; color: var(--text-secondary); font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.2s; }
.code-block:hover .copy-btn { opacity: 1; }
.code-block .copy-btn:hover { background: var(--border-default); color: var(--text-primary); }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
::-webkit-scrollbar-corner { background: transparent; }

/* Header buttons */
.header-actions { display: flex; gap: 8px; margin-right: auto; padding-left: 20px; }
.header-btn { padding: 6px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-default); border-radius: 6px; color: var(--text-secondary); cursor: pointer; font-size: 12px; transition: all 0.15s; }
.header-btn:hover { background: var(--border-default); color: var(--text-primary); border-color: var(--text-muted); }
.theme-toggle { min-width: 36px; }

/* Panel (v6.2) */
.panel { width: 380px; min-width: 380px; background: var(--bg-secondary); border-left: 1px solid var(--border-default); display: flex; flex-direction: column; overflow: hidden; }
.panel-header { padding: 12px; border-bottom: 1px solid var(--border-default); display: flex; align-items: center; justify-content: space-between; }
.panel-tabs { display: flex; gap: 4px; }
.panel-tab { padding: 6px 14px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: var(--text-secondary); cursor: pointer; font-size: 13px; transition: all 0.15s; }
.panel-tab:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.panel-tab.active { background: var(--accent-blue)22; color: var(--text-link); border-color: var(--accent-blue)44; }
.panel-close { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; padding: 0 4px; }
.panel-close:hover { color: var(--accent-red); }
.panel-body { flex: 1; overflow-y: auto; padding: 16px; }

/* Settings form */
.setting-group { margin-bottom: 20px; }
.setting-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-strong); margin-bottom: 6px; }
.setting-group input, .setting-group textarea { width: 100%; padding: 8px 12px; background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: 6px; color: var(--text-primary); font-size: 13px; font-family: inherit; resize: vertical; }
.setting-group input:focus, .setting-group textarea:focus { outline: none; border-color: var(--text-link); }
.setting-group input[readonly] { background: var(--bg-tertiary); color: var(--text-secondary); cursor: not-allowed; }
.setting-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.panel-save { width: 100%; padding: 10px; background: var(--accent-green-btn); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
.panel-save:hover { background: var(--accent-green-btn-hover); }

/* About page */
.about-section { margin-bottom: 20px; }
.about-section h3 { font-size: 14px; color: var(--text-link); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border-muted); }
.tool-card { background: var(--bg-primary); border: 1px solid var(--border-muted); border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
.tool-card .tool-name { font-weight: 600; color: var(--text-strong); font-size: 13px; }
.tool-card .tool-desc { color: var(--text-secondary); font-size: 12px; margin-top: 4px; line-height: 1.5; }
.info-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.info-row .label { color: var(--text-secondary); }
.info-row .value { color: var(--text-primary); }

/* Settings section title */
.setting-section-title { font-size: 13px; font-weight: 700; color: var(--text-link); margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border-muted); }
.setting-section-title:first-child { margin-top: 0; }
</style>
</head>
<body>

<div class="header">
  <h1>FirmClaw</h1>
  <div class="header-actions">
    <button class="header-btn theme-toggle" onclick="toggleTheme()" title="切换主题" id="themeBtn">☀</button>
    <button class="header-btn" onclick="togglePanel('settings')" title="设置">设置</button>
    <button class="header-btn" onclick="togglePanel('about')" title="关于">关于</button>
  </div>
  <div class="status">
    <div class="dot" id="statusDot"></div>
    <span id="statusText">连接断开</span>
  </div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="new-session">
      <button onclick="newSession()">+ 新建会话</button>
    </div>
    <div class="session-list" id="sessionList"></div>
  </div>

  <div class="chat-area">
    <div class="messages" id="messages">
      <div class="messages-inner">
      <div class="message system">
        <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7"/></svg></div>
        <div class="message-content">
          <div class="message-role" id="roleSystem">系统</div>
          <div class="bubble">正在连接...</div>
        </div>
      </div>
      </div>
    </div>
    <div class="input-area">
      <div class="input-row">
        <textarea id="input" placeholder="输入消息... (Enter 发送，Shift+Enter 换行)" rows="1" onkeydown="handleKey(event)"></textarea>
        <button id="sendBtn" onclick="sendMessage()" disabled>发送</button>
      </div>
    </div>
  </div>

  <!-- v6.2: 侧边面板 (Settings / About) -->
  <div class="panel" id="sidePanel" style="display:none;">
    <div class="panel-header">
      <div class="panel-tabs">
        <button class="panel-tab" data-tab="settings" onclick="switchPanelTab('settings')">设置</button>
        <button class="panel-tab" data-tab="about" onclick="switchPanelTab('about')">关于</button>
      </div>
      <button class="panel-close" onclick="togglePanel()">&times;</button>
    </div>

    <!-- Settings Tab -->
    <div class="panel-body" id="tab-settings">
      <div class="setting-section-title">工作目录</div>
      <div class="setting-group">
        <label>工作目录</label>
        <input type="text" id="cfgWorkDir" readonly>
      </div>

      <div class="setting-section-title">权限配置</div>
      <div class="setting-group">
        <label>允许路径（每行一个）</label>
        <textarea id="cfgAllowedPaths" rows="3" placeholder="D:\\code\\project1&#10;D:\\code\\project2"></textarea>
        <div class="setting-hint">文件操作仅限这些目录。</div>
      </div>
      <div class="setting-group">
        <label>受保护文件（每行一个）</label>
        <textarea id="cfgProtectedFiles" rows="2" placeholder=".env&#10;credentials.json"></textarea>
        <div class="setting-hint">这些文件无法被写入或编辑。</div>
      </div>
      <div class="setting-group">
        <label>命令黑名单（每行一个）</label>
        <textarea id="cfgCommandBlacklist" rows="2" placeholder="rm -rf /&#10;format"></textarea>
        <div class="setting-hint">匹配这些模式的命令将被阻止。</div>
      </div>

      <div class="setting-section-title">Agent 配置</div>
      <div class="setting-group">
        <label>最大循环轮次</label>
        <input type="number" id="cfgMaxTurns" min="1" max="100" placeholder="20">
        <div class="setting-hint">Agent 单次对话的最大思考-行动循环次数。</div>
      </div>
      <div class="setting-group">
        <label>上下文窗口上限 (tokens)</label>
        <input type="number" id="cfgMaxTokens" min="1000" max="2000000" step="1000" placeholder="128000">
        <div class="setting-hint">LLM 上下文窗口大小。超过时将触发裁剪或摘要。</div>
      </div>
      <div class="setting-group">
        <label>工具结果上限 (tokens)</label>
        <input type="number" id="cfgMaxToolResultTokens" min="100" max="100000" step="100" placeholder="4000">
        <div class="setting-hint">单条工具返回结果的最大 token 数。超出将被截断。</div>
      </div>

      <div class="setting-section-title">摘要配置</div>
      <div class="setting-group">
        <label>摘要触发阈值 (tokens)</label>
        <input type="number" id="cfgSummarizeThreshold" min="1000" max="500000" step="1000" placeholder="80000">
        <div class="setting-hint">历史消息 token 数超过此值时触发 LLM 摘要压缩。</div>
      </div>
      <div class="setting-group">
        <label>每次摘要消息上限 (条)</label>
        <input type="number" id="cfgMaxMessagesToSummarize" min="5" max="200" placeholder="50">
        <div class="setting-hint">每次摘要压缩处理的最大消息条数。</div>
      </div>
      <div class="setting-group">
        <label>摘要最大长度 (tokens)</label>
        <input type="number" id="cfgMaxSummaryTokens" min="100" max="10000" step="100" placeholder="2000">
        <div class="setting-hint">生成摘要的最大 token 数。</div>
      </div>

      <button class="panel-save" onclick="saveSettings()">保存设置</button>
    </div>

    <!-- About Tab -->
    <div class="panel-body" id="tab-about" style="display:none;">
      <div class="about-section">
        <h3>已注册工具</h3>
        <div id="toolList"></div>
      </div>
      <div class="about-section">
        <h3>权限摘要</h3>
        <div id="permSummary"></div>
      </div>
      <div class="about-section">
        <h3>网关状态</h3>
        <div id="gatewayInfo"></div>
      </div>
      <div class="about-section">
        <h3>模型</h3>
        <div id="modelInfo"></div>
      </div>
    </div>
  </div>
</div>

<script>
var I18N = {
  zh: {
    disconnected: '连接断开',
    connected: '已连接',
    connecting: '正在连接...',
    newSession: '+ 新建会话',
    noSessions: '暂无会话',
    inputPlaceholder: '输入消息... (Enter 发送，Shift+Enter 换行)',
    send: '发送',
    settings: '设置',
    about: '关于',
    workspaceDir: '工作目录',
    allowedPathsLabel: '允许路径（每行一个）',
    allowedPathsHint: '文件操作仅限这些目录。',
    protectedFilesLabel: '受保护文件（每行一个）',
    protectedFilesHint: '这些文件无法被写入或编辑。',
    commandBlacklistLabel: '命令黑名单（每行一个）',
    commandBlacklistHint: '匹配这些模式的命令将被阻止。',
    saveSettings: '保存设置',
    registeredTools: '已注册工具',
    noTools: '暂无工具',
    permissionSummary: '权限摘要',
    allowedPaths: '允许路径',
    protectedFiles: '受保护文件',
    blockedCommands: '阻止的命令',
    gatewayStatus: '网关状态',
    running: '运行中',
    stopped: '已停止',
    port: '端口',
    connections: '连接数',
    uptime: '运行时间',
    model: '模型',
    api: '接口地址',
    deleteSession: '删除会话',
    system: '系统',
    you: '你',
    firmclaw: 'FirmClaw',
    tool: '工具',
    result: '结果',
    copy: '复制',
    copied: '已复制！',
    confirmDelete: '确定删除该会话？此操作不可撤销。',
    // Notifications
    connectedToFirmClaw: '已连接到 FirmClaw。',
    newSessionCreated: '新会话已创建',
    sessionDeleted: '会话已删除：',
    activeSessionDeleted: '当前会话已删除，请新建或选择其他会话。',
    settingsSaved: '设置已保存。',
    error: '错误：',
    reconnecting: '连接断开（code: %s），3秒后重新连接...',
    wsError: 'WebSocket 连接错误，请查看浏览器控制台（F12）了解详情。',
    contextTrimmed: '上下文压缩：%s -> %s tokens',
    summaryGen: '摘要生成：压缩了 %s 条消息',
    memorySaved: '记忆已保存：[%s]',
    approvalRequested: '等待审批：%s',
    noMessages: '该会话暂无消息',
    switchingTo: '正在切换到会话：%s',
  },
  en: {
    disconnected: 'Disconnected',
    connected: 'Connected',
    connecting: 'Connecting to FirmClaw...',
    newSession: '+ New Session',
    noSessions: 'No sessions',
    inputPlaceholder: 'Type a message... (Enter to send, Shift+Enter for newline)',
    send: 'Send',
    settings: 'Settings',
    about: 'About',
    workspaceDir: 'Workspace Directory',
    allowedPathsLabel: 'Allowed Paths (one per line)',
    allowedPathsHint: 'File operations restricted to these directories.',
    protectedFilesLabel: 'Protected Files (one per line)',
    protectedFilesHint: 'These files cannot be written or edited.',
    commandBlacklistLabel: 'Command Blacklist (one per line)',
    commandBlacklistHint: 'Commands matching these patterns will be blocked.',
    saveSettings: 'Save Settings',
    registeredTools: 'Registered Tools',
    noTools: 'No tools',
    permissionSummary: 'Permission Summary',
    allowedPaths: 'Allowed Paths',
    protectedFiles: 'Protected Files',
    blockedCommands: 'Blocked Commands',
    gatewayStatus: 'Gateway Status',
    running: 'Running',
    stopped: 'Stopped',
    port: 'Port',
    connections: 'Connections',
    uptime: 'Uptime',
    model: 'Model',
    api: 'API',
    deleteSession: 'Delete session',
    system: 'System',
    you: 'You',
    firmclaw: 'FirmClaw',
    tool: 'Tool',
    result: 'Result',
    copy: 'Copy',
    copied: 'Copied!',
    confirmDelete: 'Delete this session? This action cannot be undone.',
    connectedToFirmClaw: 'Connected to FirmClaw.',
    newSessionCreated: 'New session created',
    sessionDeleted: 'Session deleted: ',
    activeSessionDeleted: 'Active session deleted. Create or select another session.',
    settingsSaved: 'Settings saved successfully.',
    error: 'Error: ',
    reconnecting: 'Connection lost (code: %s). Reconnecting in 3s...',
    wsError: 'WebSocket connection error. Check browser console (F12) for details.',
    contextTrimmed: 'Context trimmed: %s -> %s tokens',
    summaryGen: 'Summary: %s msgs compressed',
    memorySaved: 'Memory saved: [%s]',
    approvalRequested: 'Approval requested: %s',
    noMessages: 'No messages in this session',
    switchingTo: 'Switching to session: %s',
  }
};

var LANG = 'zh';

function t(key, ...args) {
  var str = I18N[LANG][key] || I18N['en'][key] || key;
  if (args.length > 0) {
    for (var i = 0; i < args.length; i++) {
      str = str.replace('%s', args[i]);
    }
  }
  return str;
}

let ws = null;
let requestId = 0;
let currentSessionId = null;
let pendingRequests = {};  // id -> method (用于识别响应来源)

// ──── Init ────

(function init() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = protocol + '//' + location.host + '/?token=' + encodeURIComponent(token);
  connect(url);
  initTheme();
})();

function initTheme() {
  var saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeBtn').textContent = saved === 'light' ? '☀' : '🌙';
  }
}

function toggleTheme() {
  var html = document.documentElement;
  var current = html.getAttribute('data-theme');
  var next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  document.getElementById('themeBtn').textContent = next === 'light' ? '☀' : '🌙';
}

function connect(url) {
  ws = new WebSocket(url);

  ws.onopen = () => {
    document.getElementById('statusDot').classList.add('connected');
    document.getElementById('statusText').textContent = t('connected');
    document.getElementById('sendBtn').disabled = false;
    setSystemMsg(t('connectedToFirmClaw'));
    refreshSessions();
  };

  ws.onclose = (ev) => {
    document.getElementById('statusDot').classList.remove('connected');
    document.getElementById('statusText').textContent = t('disconnected');
    document.getElementById('sendBtn').disabled = true;
    var reason = ev.reason || 'Unknown';
    var code = ev.code || 0;
    console.warn('[FirmClaw] WebSocket closed:', code, reason);
    setSystemMsg(t('reconnecting', String(code)));
    setTimeout(function() { connect(url); }, 3000);
  };

  ws.onerror = function(ev) {
    console.error('[FirmClaw] WebSocket error:', ev);
    setSystemMsg(t('wsError'));
  };

  ws.onmessage = function(event) {
    try {
      var msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };
}

// ──── JSON-RPC 2.0 ────

function sendRequest(method, params) {
  var id = ++requestId;
  pendingRequests[id] = method;
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }));
  return id;
}

function handleMessage(msg) {
  // ──── 1. 处理响应（有 id）────
  if (msg.id !== undefined && msg.id !== null) {
    var reqMethod = pendingRequests[msg.id] || '';
    delete pendingRequests[msg.id];

    if (msg.error) {
      appendSystem(t('error') + (msg.error.message || JSON.stringify(msg.error)));
      return;
    }

    if (reqMethod === 'agent.chat' && msg.result) {
      // agent.chat 响应包含最终文本
      if (msg.result.text) {
        finishThinking(msg.result.text);
      }
    } else if (reqMethod === 'session.list' && Array.isArray(msg.result)) {
      renderSessions(msg.result);
    } else if (reqMethod === 'session.new' && msg.result && msg.result.id) {
      currentSessionId = msg.result.id;
      clearMessages();
      appendSystem(t('newSessionCreated'));
      refreshSessions();
    } else if (reqMethod === 'session.resume' && msg.result && msg.result.id) {
      currentSessionId = msg.result.id;
      refreshSessions();
      loadSessionMessages(msg.result.id);
    } else if (reqMethod === 'session.messages' && msg.result && Array.isArray(msg.result.messages)) {
      renderHistoryMessages(msg.result.messages);
    } else if (reqMethod === 'session.delete' && msg.result && msg.result.success) {
      appendSystem(t('sessionDeleted') + msg.result.deletedId);
      if (currentSessionId === msg.result.deletedId) {
        currentSessionId = null;
        clearMessages();
        appendSystem(t('activeSessionDeleted'));
      }
      refreshSessions();
    } else if (reqMethod === 'gateway.status' && msg.result) {
      appendSystem('网关: ' + msg.result.connections + ' 连接, 运行时间: ' + Math.round(msg.result.uptime / 1000) + '秒');
    } else if (reqMethod === 'settings.get' && msg.result) {
      fillSettingsForm(msg.result);
      renderAboutPage(msg.result);
    } else if (reqMethod === 'settings.update' && msg.result && msg.result.success) {
      appendSystem(t('settingsSaved'));
    }
    return;
  }

  // ──── 2. 处理通知（有 method，无 id）────
  if (msg.method && msg.params !== undefined) {
    switch (msg.method) {
      case 'agent.thinking':
        appendThinking(String(msg.params));
        break;
      case 'agent.tool_start':
        appendToolStart(msg.params);
        break;
      case 'agent.tool_end':
        appendToolEnd(msg.params);
        break;
      case 'agent.message_end':
        finishThinking();
        break;
      case 'agent.error':
        appendSystem(String(msg.params));
        break;
      case 'agent.context_trimmed':
        appendSystem(t('contextTrimmed', String(msg.params.originalTokens), String(msg.params.trimmedTokens)));
        break;
      case 'agent.summary_generated':
        appendSystem(t('summaryGen', String(msg.params.compressedCount)));
        break;
      case 'agent.memory_saved':
        appendSystem(t('memorySaved', msg.params.id));
        break;
      case 'agent.approval_requested':
        appendSystem(t('approvalRequested', msg.params.toolName || ''));
        break;
      case 'session.started':
        if (msg.params && msg.params.id) {
          currentSessionId = msg.params.id;
          refreshSessions();
        }
        break;
    }
  }
}

// ──── UI Helpers ────

function clearMessages() {
  var el = document.getElementById('messages');
  el.innerHTML = '<div class="messages-inner"></div>';
}

function setSystemMsg(text) {
  clearMessages();
  appendSystem(text);
}

function appendSystem(text) {
  var el = getInner();
  var div = document.createElement('div');
  div.className = 'message system';
  div.innerHTML = '<div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7"/></svg></div>'
    + '<div class="message-content"><div class="message-role">' + t('system') + '</div><div class="bubble">' + escapeHtml(text) + '</div></div>';
  el.appendChild(div);
  scrollToBottom();
}

function getInner() {
  var el = document.getElementById('messages');
  var inner = el.querySelector('.messages-inner');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'messages-inner';
    el.appendChild(inner);
  }
  return inner;
}

/** 向服务端请求指定 session 的消息历史 */
function loadSessionMessages(sessionId) {
  sendRequest('session.messages', { sessionId: sessionId });
}

/** 渲染历史消息列表 */
function renderHistoryMessages(messages) {
  clearMessages();
  var el = getInner();
  if (!messages || messages.length === 0) {
    appendSystem(t('noMessages'));
    return;
  }
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var div;

    if (msg.role === 'user') {
      div = createUserMsg(msg.content);
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        div = createToolMsg(msg.tool_calls);
      } else if (msg.content) {
        div = createAssistantMsg(msg.content);
      } else {
        continue;
      }
    } else if (msg.role === 'tool') {
      div = createToolResultMsg(msg.content);
    } else {
      continue;
    }

    if (div) el.appendChild(div);
  }
  scrollToBottom();
}

/** 创建用户消息 DOM */
function createUserMsg(text) {
  var div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = '<div class="message-avatar">U</div>'
    + '<div class="message-content"><div class="message-role">' + t('you') + '</div>'
    + '<div class="bubble">' + escapeHtml(text).replace(/\\n/g, '<br>') + '</div></div>';
  return div;
}

/** 创建助手消息 DOM */
function createAssistantMsg(text) {
  var div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<div class="message-avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a6.5 6.5 0 0 0-6.5 6.5c0 1.8.7 3.4 1.9 4.6l-.4 2.2 2.4-1.2A6.5 6.5 0 0 0 8 14a6.5 6.5 0 0 0 6.5-6.5A6.5 6.5 0 0 0 8 1z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">' + t('firmclaw') + '</div>'
    + '<div class="bubble md-content">' + renderMarkdown(text) + '</div></div>';
  return div;
}

/** 创建工具调用消息 DOM */
function createToolMsg(toolCalls) {
  var div = document.createElement('div');
  div.className = 'message tool';
  var toolHtml = '';
  for (var j = 0; j < toolCalls.length; j++) {
    var tc = toolCalls[j];
    var argsStr = typeof tc.function.arguments === 'string'
      ? tc.function.arguments.substring(0, 300)
      : JSON.stringify(tc.function.arguments || {}, null, 2).substring(0, 300);
    toolHtml += '<span class="tool-name">' + escapeHtml(tc.function.name) + '</span>\\n' + escapeHtml(argsStr);
    if (j < toolCalls.length - 1) toolHtml += '\\n---\\n';
  }
  div.innerHTML = '<div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-3zM6 7.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zM1 11.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">' + t('tool') + '</div>'
    + '<div class="bubble"><pre>' + toolHtml + '</pre></div></div>';
  return div;
}

/** 创建工具结果消息 DOM */
function createToolResultMsg(content) {
  if (!content) return null;
  var div = document.createElement('div');
  div.className = 'message tool';
  var short = content.length > 500 ? content.substring(0, 500) + '\\n... (已截断)' : content;
  div.innerHTML = '<div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-3z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">' + t('result') + '</div>'
    + '<div class="bubble"><span class="tool-result">' + escapeHtml(short) + '</span></div></div>';
  return div;
}

var thinkingEl = null;
var thinkingText = '';

function appendThinking(text) {
  if (!thinkingEl) {
    var el = getInner();
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'message assistant';
    thinkingEl.innerHTML = '<div class="message-avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a6.5 6.5 0 0 0-6.5 6.5c0 1.8.7 3.4 1.9 4.6l-.4 2.2 2.4-1.2A6.5 6.5 0 0 0 8 14a6.5 6.5 0 0 0 6.5-6.5A6.5 6.5 0 0 0 8 1z"/></svg></div>'
      + '<div class="message-content"><div class="message-role">' + t('firmclaw') + '</div>'
      + '<div class="bubble thinking md-content"></div></div>';
    el.appendChild(thinkingEl);
  }
  thinkingText += text;
  thinkingEl.querySelector('.bubble').textContent = thinkingText;
  scrollToBottom();
}

function finishThinking(finalText) {
  if (thinkingEl) {
    var text = finalText || thinkingText;
    if (text) {
      var bubble = thinkingEl.querySelector('.bubble');
      bubble.className = 'bubble md-content';
      bubble.innerHTML = renderMarkdown(text);
    } else {
      thinkingEl.remove();
    }
  }
  thinkingEl = null;
  thinkingText = '';
}

function appendToolStart(data) {
  if (thinkingEl) finishThinking();
  var el = getInner();
  var div = createToolMsg([{ function: { name: data.toolName || '?', arguments: JSON.stringify(data.args || {}) } }]);
  div.id = 'tool-' + Date.now();
  el.appendChild(div);
  scrollToBottom();
}

function appendToolEnd(data) {
  // tool result is included in assistant's next thinking
}

function appendUserMsg(text) {
  var el = getInner();
  el.appendChild(createUserMsg(text));
  scrollToBottom();
}

// ──── Markdown rendering ────
__RENDER_MARKDOWN_PLACEHOLDER__

function copyCode(btn) {
  var codeEl = btn.parentElement.querySelector('code');
  if (!codeEl) return;
  var text = codeEl.textContent || codeEl.innerText;
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = t('copied');
    setTimeout(function() { btn.textContent = t('copy'); }, 1500);
  });
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  var el = document.getElementById('messages');
  el.scrollTop = el.scrollHeight;
}

// ──── User Actions ────

function sendMessage() {
  var input = document.getElementById('input');
  var text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  appendUserMsg(text);
  sendRequest('agent.chat', { message: text });
  input.value = '';
  input.style.height = 'auto';
}

function newSession() {
  sendRequest('session.new', {});
}

function switchSession(sessionId) {
  currentSessionId = sessionId;
  setSystemMsg(t('switchingTo', sessionId));
  sendRequest('session.resume', { sessionId: sessionId });
  document.querySelectorAll('.session-item').forEach(function(el) { el.classList.remove('active'); });
  if (event && event.target) event.target.classList.add('active');
}

function deleteSession(sessionId) {
  if (!confirm(t('confirmDelete'))) return;
  sendRequest('session.delete', { sessionId: sessionId });
}

function refreshSessions() {
  sendRequest('session.list', {});
}

// ──── v6.2: Settings Panel ────

function togglePanel(tab) {
  var panel = document.getElementById('sidePanel');
  if (panel.style.display === 'none') {
    panel.style.display = 'flex';
    sendRequest('settings.get', {});
  } else {
    panel.style.display = 'none';
  }
}

function switchPanelTab(tab) {
  document.querySelectorAll('.panel-tab').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.panel-body').forEach(function(el) { el.style.display = 'none'; });
  document.querySelector('.panel-tab[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('tab-' + tab).style.display = 'block';
}

function fillSettingsForm(data) {
  if (!data) return;
  document.getElementById('cfgWorkDir').value = data.workDir || '';
  var perm = data.permissions || {};
  document.getElementById('cfgAllowedPaths').value = (perm.allowedPaths || []).join('\\n');
  document.getElementById('cfgProtectedFiles').value = (perm.protectedFiles || []).join('\\n');
  document.getElementById('cfgCommandBlacklist').value = (perm.commandBlacklist || []).join('\\n');
  // v7.1: Agent \u914d\u7f6e
  var agent = data.agent || {};
  if (agent.maxTurns) document.getElementById('cfgMaxTurns').value = agent.maxTurns;
  if (agent.maxTokens) document.getElementById('cfgMaxTokens').value = agent.maxTokens;
  if (agent.maxToolResultTokens) document.getElementById('cfgMaxToolResultTokens').value = agent.maxToolResultTokens;
  // v7.1: \u6458\u8981\u914d\u7f6e
  var summ = data.summarizer || {};
  if (summ.summarizeThreshold) document.getElementById('cfgSummarizeThreshold').value = summ.summarizeThreshold;
  if (summ.maxMessagesToSummarize) document.getElementById('cfgMaxMessagesToSummarize').value = summ.maxMessagesToSummarize;
  if (summ.maxSummaryTokens) document.getElementById('cfgMaxSummaryTokens').value = summ.maxSummaryTokens;
}

function renderAboutPage(data) {
  if (!data) return;
  // 渲染工具列表
  var toolsHtml = '';
  (data.tools || []).forEach(function(t) {
    toolsHtml += '<div class="tool-card"><div class="tool-name">' + escapeHtml(t.name)
      + '</div><div class="tool-desc">' + escapeHtml(t.description) + '</div></div>';
  });
  document.getElementById('toolList').innerHTML = toolsHtml || '<div style="color:var(--text-muted)">' + t('noTools') + '</div>';

  // 渲染权限摘要
  var perm = data.permissions || {};
  document.getElementById('permSummary').innerHTML =
    '<div class="info-row"><span class="label">' + t('allowedPaths') + '</span><span class="value">' + (perm.allowedPaths?.length || 0) + ' 目录</span></div>'
    + '<div class="info-row"><span class="label">' + t('protectedFiles') + '</span><span class="value">' + (perm.protectedFiles?.length || 0) + ' 文件</span></div>'
    + '<div class="info-row"><span class="label">' + t('blockedCommands') + '</span><span class="value">' + (perm.commandBlacklist?.length || 0) + ' 模式</span></div>';

  // 渲染网关信息
  var gw = data.gateway || {};
  var model = data.model || {};
  document.getElementById('gatewayInfo').innerHTML =
    '<div class="info-row"><span class="label">状态</span><span class="value">' + (gw.running ? t('running') : t('stopped')) + '</span></div>'
    + '<div class="info-row"><span class="label">' + t('port') + '</span><span class="value">' + (gw.port || '-') + '</span></div>'
    + '<div class="info-row"><span class="label">' + t('connections') + '</span><span class="value">' + (gw.connections || 0) + '</span></div>'
    + '<div class="info-row"><span class="label">' + t('uptime') + '</span><span class="value">' + Math.round((gw.uptime || 0) / 1000) + '秒</span></div>';

  document.getElementById('modelInfo').innerHTML =
    '<div class="info-row"><span class="label">' + t('model') + '</span><span class="value">' + escapeHtml(model.name || '-') + '</span></div>'
    + '<div class="info-row"><span class="label">' + t('api') + '</span><span class="value">' + escapeHtml(model.baseURL || '-') + '</span></div>';
}

function saveSettings() {
  var allowedPaths = document.getElementById('cfgAllowedPaths').value
    .split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
  var protectedFiles = document.getElementById('cfgProtectedFiles').value
    .split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
  var commandBlacklist = document.getElementById('cfgCommandBlacklist').value
    .split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);

  // v7.1: Agent \u914d\u7f6e
  var maxTurns = parseInt(document.getElementById('cfgMaxTurns').value);
  var maxTokens = parseInt(document.getElementById('cfgMaxTokens').value);
  var maxToolResultTokens = parseInt(document.getElementById('cfgMaxToolResultTokens').value);

  // v7.1: \u6458\u8981\u914d\u7f6e
  var summarizeThreshold = parseInt(document.getElementById('cfgSummarizeThreshold').value);
  var maxMessagesToSummarize = parseInt(document.getElementById('cfgMaxMessagesToSummarize').value);
  var maxSummaryTokens = parseInt(document.getElementById('cfgMaxSummaryTokens').value);

  var payload = {
    allowedPaths: allowedPaths,
    protectedFiles: protectedFiles,
    commandBlacklist: commandBlacklist,
  };

  // \u53ea\u6709\u5728\u7528\u6237\u586b\u5199\u4e86\u503c\u65f6\u624d\u53d1\u9001
  if (!isNaN(maxTurns) && maxTurns > 0) payload.maxTurns = maxTurns;
  if (!isNaN(maxTokens) && maxTokens > 0) payload.maxTokens = maxTokens;
  if (!isNaN(maxToolResultTokens) && maxToolResultTokens > 0) payload.maxToolResultTokens = maxToolResultTokens;
  if (!isNaN(summarizeThreshold) && summarizeThreshold > 0) payload.summarizeThreshold = summarizeThreshold;
  if (!isNaN(maxMessagesToSummarize) && maxMessagesToSummarize > 0) payload.maxMessagesToSummarize = maxMessagesToSummarize;
  if (!isNaN(maxSummaryTokens) && maxSummaryTokens > 0) payload.maxSummaryTokens = maxSummaryTokens;

  sendRequest('settings.update', payload);
}

function renderSessions(sessions) {
  var list = document.getElementById('sessionList');
  list.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">' + t('noSessions') + '</div>';
    return;
  }
  sessions.forEach(function(s) {
    var item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
    item.dataset.sessionId = s.id;
    item.innerHTML = '<div class="session-item-inner">'
      + '<span class="session-item-title">' + escapeHtml(s.title || s.id) + '</span>'
      + '<button class="session-item-delete" title="' + t('deleteSession') + '">&times;</button>'
      + '</div>';
    item.querySelector('.session-item-title').onclick = function(e) {
      e.stopPropagation();
      switchSession(s.id);
    };
    item.querySelector('.session-item-delete').onclick = function(e) {
      e.stopPropagation();
      deleteSession(s.id);
    };
    list.appendChild(item);
  });
}

// ──── Input Handling ────

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  setTimeout(function() {
    var el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, 0);
}
</script>
</body>
</html>`.replace('__RENDER_MARKDOWN_PLACEHOLDER__', RENDER_MARKDOWN_JS);
}
