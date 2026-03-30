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
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; height: 100vh; display: flex; flex-direction: column; }

/* Header */
.header { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 16px; color: #58a6ff; }
.header .status { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8b949e; }
.header .status .dot { width: 8px; height: 8px; border-radius: 50%; background: #f85149; }
.header .status .dot.connected { background: #3fb950; }

/* Layout */
.main { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 240px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; }
.sidebar .new-session { padding: 12px; border-bottom: 1px solid #30363d; }
.sidebar .new-session button { width: 100%; padding: 8px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 13px; }
.sidebar .new-session button:hover { background: #30363d; }
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-item { padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 4px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-item:hover { background: #21262d; color: #c9d1d9; }
.session-item.active { background: #1f6feb22; color: #58a6ff; }

/* Chat Area */
.chat-area { flex: 1; display: flex; flex-direction: column; }
.messages { flex: 1; overflow-y: auto; padding: 20px; }
.message { margin-bottom: 16px; max-width: 800px; }
.message.user { text-align: right; margin-left: auto; }
.message .bubble { display: inline-block; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; text-align: left; }
.message.user .bubble { background: #1f6feb; color: #fff; }
.message.assistant .bubble { background: #21262d; border: 1px solid #30363d; }
.message.system .bubble { background: #161b22; border: 1px solid #30363d; color: #8b949e; font-size: 12px; }
.message.tool .bubble { background: #1c2128; border: 1px solid #30363d; font-size: 13px; font-family: 'Cascadia Code', 'Fira Code', monospace; }
.tool-name { color: #58a6ff; font-weight: 600; }
.tool-result { color: #8b949e; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; margin-top: 4px; }

/* Thinking */
.thinking { color: #8b949e; font-style: italic; padding: 4px 0; }

/* Input */
.input-area { padding: 16px 20px; border-top: 1px solid #30363d; }
.input-row { display: flex; gap: 8px; }
.input-row textarea { flex: 1; padding: 10px 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 8px; color: #c9d1d9; font-size: 14px; resize: none; font-family: inherit; min-height: 42px; max-height: 200px; }
.input-row textarea:focus { outline: none; border-color: #58a6ff; }
.input-row button { padding: 10px 20px; background: #1f6feb; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.input-row button:hover { background: #388bfd; }
.input-row button:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }

/* Markdown rendering */
.bubble h1, .bubble h2, .bubble h3 { margin: 12px 0 8px; color: #e6edf3; }
.bubble h1 { font-size: 1.4em; }
.bubble h2 { font-size: 1.2em; }
.bubble h3 { font-size: 1.1em; }
.bubble p { margin: 8px 0; }
.bubble code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.9em; }
.bubble pre { background: #0d1117; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
.bubble pre code { background: none; padding: 0; }
.bubble ul, .bubble ol { padding-left: 20px; margin: 8px 0; }
.bubble blockquote { border-left: 3px solid #30363d; padding-left: 12px; color: #8b949e; margin: 8px 0; }
.bubble a { color: #58a6ff; text-decoration: none; }
.bubble a:hover { text-decoration: underline; }
.bubble hr { border: none; border-top: 1px solid #30363d; margin: 12px 0; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }
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
      <div class="message system">
        <div class="bubble">Connecting to FirmClaw...</div>
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
  el.innerHTML = '';
}

function setSystemMsg(text) {
  clearMessages();
  appendSystem(text);
}

function appendSystem(text) {
  var el = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'message system';
  div.innerHTML = '<div class="bubble">' + escapeHtml(text) + '</div>';
  el.appendChild(div);
  scrollToBottom();
}

/** 向服务端请求指定 session 的消息历史 */
function loadSessionMessages(sessionId) {
  sendRequest('session.messages', { sessionId: sessionId });
}

/** 渲染历史消息列表 */
function renderHistoryMessages(messages) {
  clearMessages();
  if (!messages || messages.length === 0) {
    appendSystem('No messages in this session');
    return;
  }
  var el = document.getElementById('messages');
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var div = document.createElement('div');

    if (msg.role === 'user') {
      div.className = 'message user';
      div.innerHTML = '<div class="bubble">' + escapeHtml(msg.content) + '</div>';
    } else if (msg.role === 'assistant') {
      // assistant 消息：如果有 tool_calls 则显示为 tool 气泡，否则为普通 assistant 气泡
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        div.className = 'message tool';
        var toolHtml = '';
        for (var j = 0; j < msg.tool_calls.length; j++) {
          var tc = msg.tool_calls[j];
          var argsStr = typeof tc.function.arguments === 'string'
            ? tc.function.arguments.substring(0, 200)
            : JSON.stringify(tc.function.arguments || {}).substring(0, 200);
          toolHtml += '<span class="tool-name">[' + escapeHtml(tc.function.name) + ']</span> ' + escapeHtml(argsStr);
          if (j < msg.tool_calls.length - 1) toolHtml += '<br>';
        }
        div.innerHTML = '<div class="bubble">' + toolHtml + '</div>';
      } else if (msg.content) {
        div.className = 'message assistant';
        div.innerHTML = '<div class="bubble">' + renderMarkdown(msg.content) + '</div>';
      } else {
        continue; // 跳过空消息
      }
    } else if (msg.role === 'tool') {
      div.className = 'message tool';
      div.innerHTML = '<div class="bubble"><span class="tool-result">' + escapeHtml(msg.content || '').substring(0, 300) + '</span></div>';
    } else if (msg.role === 'system') {
      continue; // 跳过系统消息（已在 system prompt 中）
    } else {
      continue;
    }

    el.appendChild(div);
  }
  scrollToBottom();
}

var thinkingEl = null;
var thinkingText = '';

function appendThinking(text) {
  if (!thinkingEl) {
    var el = document.getElementById('messages');
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'message assistant';
    thinkingEl.innerHTML = '<div class="bubble thinking"></div>';
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
      thinkingEl.querySelector('.bubble').className = 'bubble';
      thinkingEl.querySelector('.bubble').innerHTML = renderMarkdown(text);
    } else {
      thinkingEl.remove();
    }
  }
  thinkingEl = null;
  thinkingText = '';
}

function appendToolStart(data) {
  if (thinkingEl) finishThinking();
  var el = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'message tool';
  div.id = 'tool-' + Date.now();
  var argsStr = typeof data.args === 'object' ? JSON.stringify(data.args, null, 2) : String(data.args || '');
  div.innerHTML = '<div class="bubble"><span class="tool-name">[' + escapeHtml(data.toolName || '?') + ']</span> ' + escapeHtml(argsStr).substring(0, 500) + '</div>';
  el.appendChild(div);
  scrollToBottom();
}

function appendToolEnd(data) {
  // tool result is included in assistant's next thinking
}

function appendUserMsg(text) {
  var el = document.getElementById('messages');
  var div = document.createElement('div');
  div.className = 'message user';
  div.innerHTML = '<div class="bubble">' + escapeHtml(text) + '</div>';
  el.appendChild(div);
  scrollToBottom();
}

// ──── Markdown rendering (minimal) ────

function renderMarkdown(text) {
  var md = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\x60\x60\x60([\\s\\S]*?)\x60\x60\x60/g, '<pre><code>$1</code></pre>')
    .replace(/\x60([^\x60]+?)\x60/g, '<code>$1</code>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>')
    .replace(/\\n\\n+/g, '</p><p>')
    .replace(/\\n/g, '<br>');
  return md;
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
