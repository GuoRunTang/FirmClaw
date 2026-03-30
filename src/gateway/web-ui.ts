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

export function getWebUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FirmClaw</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif; background: #0d1117; color: #c9d1d9; height: 100vh; display: flex; flex-direction: column; }

/* Header */
.header { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 16px; color: #58a6ff; letter-spacing: 0.5px; }
.header .status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8b949e; }
.header .status .dot { width: 8px; height: 8px; border-radius: 50%; background: #f85149; transition: background 0.3s; }
.header .status .dot.connected { background: #3fb950; box-shadow: 0 0 6px #3fb95066; }

/* Layout */
.main { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 260px; min-width: 260px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; }
.sidebar .new-session { padding: 12px; border-bottom: 1px solid #30363d; }
.sidebar .new-session button { width: 100%; padding: 8px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.15s; }
.sidebar .new-session button:hover { background: #30363d; border-color: #484f58; }
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 2px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: all 0.15s; }
.session-item:hover { background: #21262d; color: #c9d1d9; }
.session-item.active { background: #1f6feb22; color: #58a6ff; font-weight: 500; }

/* Chat Area */
.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.messages { flex: 1; overflow-y: auto; padding: 24px 0; }
.messages-inner { max-width: 820px; margin: 0 auto; padding: 0 24px; }

/* Message row: avatar + content */
.message { display: flex; gap: 12px; margin-bottom: 20px; align-items: flex-start; }
.message.user { flex-direction: row-reverse; }
.message-avatar { width: 32px; height: 32px; min-width: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
.message.user .message-avatar { background: #1f6feb; color: #fff; }
.message.assistant .message-avatar { background: #238636; color: #fff; }
.message.system .message-avatar { background: #30363d; color: #8b949e; font-size: 12px; }
.message.tool .message-avatar { background: #30363d; color: #58a6ff; font-size: 12px; }

.message-content { min-width: 0; max-width: 680px; }
.message.user .message-content { text-align: right; }

.message-role { font-size: 12px; font-weight: 600; color: #8b949e; margin-bottom: 4px; }
.message.user .message-role { text-align: right; }

.message .bubble { display: inline-block; padding: 10px 16px; border-radius: 12px; font-size: 14px; line-height: 1.7; text-align: left; }
.message.user .bubble { background: #1f6feb; color: #fff; border-bottom-right-radius: 4px; }
.message.assistant .bubble { background: #161b22; border: 1px solid #30363d; border-bottom-left-radius: 4px; }
.message.system .bubble { background: #0d1117; border: 1px dashed #30363d; color: #8b949e; font-size: 12px; }
.message.tool .bubble { background: #0d1117; border: 1px solid #30363d; font-size: 13px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; border-left: 3px solid #58a6ff; border-radius: 6px; border-bottom-left-radius: 0; }

/* Tool */
.tool-name { color: #58a6ff; font-weight: 600; }
.tool-result { color: #8b949e; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; margin-top: 4px; }

/* Thinking */
.thinking { color: #8b949e; font-style: italic; padding: 4px 0; }
.thinking::after { content: '...'; animation: blink 1s steps(3) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* Input */
.input-area { padding: 16px 24px; border-top: 1px solid #30363d; background: #0d1117; }
.input-row { max-width: 820px; margin: 0 auto; display: flex; gap: 8px; }
.input-row textarea { flex: 1; padding: 10px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 14px; resize: none; font-family: inherit; min-height: 42px; max-height: 200px; transition: border-color 0.2s; }
.input-row textarea:focus { outline: none; border-color: #58a6ff; box-shadow: 0 0 0 2px #58a6ff22; }
.input-row button { padding: 10px 20px; background: #1f6feb; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background 0.15s; }
.input-row button:hover { background: #388bfd; }
.input-row button:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }

/* Markdown rendering */
.md-content h1, .md-content h2, .md-content h3, .md-content h4 { margin: 16px 0 8px; color: #e6edf3; font-weight: 600; }
.md-content h1 { font-size: 1.35em; border-bottom: 1px solid #30363d; padding-bottom: 6px; }
.md-content h2 { font-size: 1.2em; border-bottom: 1px solid #21262d; padding-bottom: 4px; }
.md-content h3 { font-size: 1.1em; }
.md-content p { margin: 8px 0; }
.md-content strong { color: #e6edf3; font-weight: 600; }
.md-content em { color: #d2a8ff; }
.md-content code { background: #1c2128; padding: 2px 6px; border-radius: 4px; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 0.88em; color: #ff7b72; }
.md-content pre { background: #0d1117; padding: 14px 16px; border-radius: 8px; overflow-x: auto; margin: 10px 0; border: 1px solid #21262d; position: relative; }
.md-content pre code { background: none; padding: 0; color: #c9d1d9; font-size: 0.85em; }
.md-content ul, .md-content ol { padding-left: 24px; margin: 8px 0; }
.md-content li { margin: 4px 0; }
.md-content li::marker { color: #58a6ff; }
.md-content ol li::marker { color: #58a6ff; font-weight: 600; }
.md-content blockquote { border-left: 3px solid #58a6ff; padding: 8px 16px; color: #8b949e; margin: 10px 0; background: #161b22; border-radius: 0 6px 6px 0; }
.md-content a { color: #58a6ff; text-decoration: none; }
.md-content a:hover { text-decoration: underline; }
.md-content hr { border: none; border-top: 1px solid #30363d; margin: 16px 0; }
.md-content table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 13px; }
.md-content th, .md-content td { border: 1px solid #30363d; padding: 8px 12px; text-align: left; }
.md-content th { background: #161b22; font-weight: 600; color: #e6edf3; }
.md-content tr:hover { background: #161b2244; }

/* Code block copy button */
.code-block { position: relative; }
.code-block .copy-btn { position: absolute; top: 6px; right: 6px; padding: 3px 8px; background: #21262d; border: 1px solid #30363d; border-radius: 4px; color: #8b949e; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.2s; }
.code-block:hover .copy-btn { opacity: 1; }
.code-block .copy-btn:hover { background: #30363d; color: #c9d1d9; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }
::-webkit-scrollbar-corner { background: transparent; }
</style>
</head>
<body>

<div class="header">
  <h1>FirmClaw</h1>
  <div class="status">
    <div class="dot" id="statusDot"></div>
    <span id="statusText">Disconnected</span>
  </div>
</div>

<div class="main">
  <div class="sidebar">
    <div class="new-session">
      <button onclick="newSession()">+ New Session</button>
    </div>
    <div class="session-list" id="sessionList"></div>
  </div>

  <div class="chat-area">
    <div class="messages" id="messages">
      <div class="messages-inner">
      <div class="message system">
        <div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7"/></svg></div>
        <div class="message-content">
          <div class="message-role">System</div>
          <div class="bubble">Connecting to FirmClaw...</div>
        </div>
      </div>
      </div>
    </div>
    <div class="input-area">
      <div class="input-row">
        <textarea id="input" placeholder="Type a message... (Enter to send, Shift+Enter for newline)" rows="1" onkeydown="handleKey(event)"></textarea>
        <button id="sendBtn" onclick="sendMessage()" disabled>Send</button>
      </div>
    </div>
  </div>
</div>

<script>
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
})();

function connect(url) {
  ws = new WebSocket(url);

  ws.onopen = () => {
    document.getElementById('statusDot').classList.add('connected');
    document.getElementById('statusText').textContent = 'Connected';
    document.getElementById('sendBtn').disabled = false;
    setSystemMsg('Connected to FirmClaw.');
    refreshSessions();
  };

  ws.onclose = (ev) => {
    document.getElementById('statusDot').classList.remove('connected');
    document.getElementById('statusText').textContent = 'Disconnected';
    document.getElementById('sendBtn').disabled = true;
    var reason = ev.reason || 'Unknown';
    var code = ev.code || 0;
    console.warn('[FirmClaw] WebSocket closed:', code, reason);
    setSystemMsg('Connection lost (code: ' + code + '). Reconnecting in 3s...');
    setTimeout(function() { connect(url); }, 3000);
  };

  ws.onerror = function(ev) {
    console.error('[FirmClaw] WebSocket error:', ev);
    setSystemMsg('WebSocket connection error. Check browser console (F12) for details.');
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
      appendSystem('Error: ' + (msg.error.message || JSON.stringify(msg.error)));
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
      appendSystem('New session created');
      refreshSessions();
    } else if (reqMethod === 'session.resume' && msg.result && msg.result.id) {
      currentSessionId = msg.result.id;
      refreshSessions();
      // 自动拉取该会话的消息历史
      loadSessionMessages(msg.result.id);
    } else if (reqMethod === 'session.messages' && msg.result && Array.isArray(msg.result.messages)) {
      renderHistoryMessages(msg.result.messages);
    } else if (reqMethod === 'gateway.status' && msg.result) {
      appendSystem('Gateway: ' + msg.result.connections + ' connections, uptime: ' + Math.round(msg.result.uptime / 1000) + 's');
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
        appendSystem('Context trimmed: ' + msg.params.originalTokens + ' -> ' + msg.params.trimmedTokens + ' tokens');
        break;
      case 'agent.summary_generated':
        appendSystem('Summary: ' + msg.params.compressedCount + ' msgs compressed');
        break;
      case 'agent.memory_saved':
        appendSystem('Memory saved: [' + msg.params.id + ']');
        break;
      case 'agent.approval_requested':
        appendSystem('Approval requested: ' + (msg.params.toolName || ''));
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
    + '<div class="message-content"><div class="message-role">System</div><div class="bubble">' + escapeHtml(text) + '</div></div>';
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
    appendSystem('No messages in this session');
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
    + '<div class="message-content"><div class="message-role">You</div>'
    + '<div class="bubble">' + escapeHtml(text).replace(/\\n/g, '<br>') + '</div></div>';
  return div;
}

/** 创建助手消息 DOM */
function createAssistantMsg(text) {
  var div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<div class="message-avatar"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a6.5 6.5 0 0 0-6.5 6.5c0 1.8.7 3.4 1.9 4.6l-.4 2.2 2.4-1.2A6.5 6.5 0 0 0 8 14a6.5 6.5 0 0 0 6.5-6.5A6.5 6.5 0 0 0 8 1z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">FirmClaw</div>'
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
    toolHtml += '<span class="tool-name">' + escapeHtml(tc.function.name) + '</span>\n' + escapeHtml(argsStr);
    if (j < toolCalls.length - 1) toolHtml += '\n---\n';
  }
  div.innerHTML = '<div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-3zM6 7.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5zM1 11.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">Tool</div>'
    + '<div class="bubble"><pre>' + toolHtml + '</pre></div></div>';
  return div;
}

/** 创建工具结果消息 DOM */
function createToolResultMsg(content) {
  if (!content) return null;
  var div = document.createElement('div');
  div.className = 'message tool';
  var short = content.length > 500 ? content.substring(0, 500) + '\\n... (truncated)' : content;
  div.innerHTML = '<div class="message-avatar"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-3z"/></svg></div>'
    + '<div class="message-content"><div class="message-role">Result</div>'
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
      + '<div class="message-content"><div class="message-role">FirmClaw</div>'
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

function renderMarkdown(text) {
  var html = escapeHtml(text);

  // Code blocks: ```lang\n...\n```
  html = html.replace(/\x60\x60\x60(\\w*)\\n?([\\s\\S]*?)\\x60\x60\x60/g, function(match, lang, code) {
    var langLabel = lang ? '<span style="color:#8b949e;font-size:11px;position:absolute;top:4px;left:12px">' + lang + '</span>' : '';
    var id = 'code-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    return '<div class="code-block" style="position:relative"><div class="copy-btn" onclick="copyCode(this)">Copy</div>' + langLabel + '<pre><code id="' + id + '">' + code + '</code></pre></div>';
  });

  // Inline code: `...`
  html = html.replace(/\x60([^\x60]+?)\x60/g, '<code>$1</code>');

  // Bold: **...**
  html = html.replace(/\\*\\*([^\\*]+?)\\*\\*/g, '<strong>$1</strong>');

  // Italic: *...*
  html = html.replace(/\\*([^\\*]+?)\\*/g, '<em>$1</em>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists: collect consecutive - items
  html = html.replace(/(^- .+(\\n|$))+/gm, function(block) {
    var items = block.trim().split('\\n').map(function(line) { return '<li>' + line.replace(/^- /, '') + '</li>'; }).join('');
    return '<ul>' + items + '</ul>';
  });

  // Ordered lists: collect consecutive 1. 2. items
  html = html.replace(/(^\\d+\\. .+(\\n|$))+/gm, function(block) {
    var items = block.trim().split('\\n').map(function(line) { return '<li>' + line.replace(/^\\d+\\. /, '') + '</li>'; }).join('');
    return '<ol>' + items + '</ol>';
  });

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquote: > ...
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Links: [text](url)
  html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Paragraphs: double newline
  html = html.replace(/\\n\\n+/g, '</p><p>');

  // Single newlines
  html = html.replace(/\\n/g, '<br>');

  // Wrap in paragraph
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\\s*<(h[1-4]|ul|ol|pre|blockquote|hr|div)/g, '<$1');
  html = html.replace(/<\\/(h[1-4]|ul|ol|pre|blockquote|hr|div)>\\s*<\\/p>/g, '</$1>');
  html = html.replace(/<p>\\s*<\\/p>/g, '');

  return html;
}

function copyCode(btn) {
  var codeEl = btn.parentElement.querySelector('code');
  if (!codeEl) return;
  var text = codeEl.textContent || codeEl.innerText;
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
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
  setSystemMsg('Switching to session: ' + sessionId);
  sendRequest('session.resume', { sessionId: sessionId });
  document.querySelectorAll('.session-item').forEach(function(el) { el.classList.remove('active'); });
  if (event && event.target) event.target.classList.add('active');
}

function refreshSessions() {
  sendRequest('session.list', {});
}

function renderSessions(sessions) {
  var list = document.getElementById('sessionList');
  list.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    list.innerHTML = '<div style="padding: 12px; color: #484f58; font-size: 13px;">No sessions</div>';
    return;
  }
  sessions.forEach(function(s) {
    var item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
    item.textContent = s.title || s.id;
    item.onclick = function() { switchSession(s.id); };
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
</html>`;
}
