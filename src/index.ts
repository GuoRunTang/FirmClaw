/**
 * src/index.ts
 *
 * 程序入口文件。
 *
 * v1.0: 初始 CLI（基础 ReAct 循环 + bash 工具）
 * v1.6: 注册全部 4 工具 + 权限策略
 * v2.4: 集成 Phase 3 全部模块（会话管理 + 动态提示词 + 上下文裁剪 + 斜杠命令）
 * v3.4: 集成 Phase 4 全部模块（摘要压缩 + 记忆管理 + 全文搜索 + 新斜杠命令）
 * v5.1: 集成 Phase 6 v5.1 模块（WebSocket Gateway + /serve 命令）
 * v5.2: 集成 CLI 富文本渲染器 + 进度指示器
 * v5.3: 集成子智能体管理器（SubagentManager）
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { LLMClient } from './llm/client.js';
import { ToolRegistry } from './tools/registry.js';
import { bashTool } from './tools/bash.js';
import { readTool } from './tools/read.js';
import { writeTool } from './tools/write.js';
import { editTool } from './tools/edit.js';
import { DefaultPermissionPolicy } from './tools/permissions.js';
import { AgentLoop } from './agent/agent-loop.js';
import { SessionManager } from './session/manager.js';
import { ContextBuilder } from './session/context-builder.js';
import { TokenCounter } from './utils/token-counter.js';
import { Summarizer } from './session/summarizer.js';
import { MemoryManager } from './session/memory-manager.js';
import type { MemoryTag } from './session/memory-manager.js';
import { SearchEngine } from './session/search-engine.js';
import { GatewayServer } from './gateway/server.js';
import { AuthGuard } from './gateway/auth.js';
import { Renderer } from './cli/renderer.js';
import { ProgressIndicator } from './cli/progress.js';
import { SubagentManager } from './agent/subagent-manager.js';

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  // ──── 1. 加载配置 ────
  const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.LLM_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimax.chat/v1';
  const model = process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || 'MiniMax-M2.7';

  if (!apiKey) {
    console.error('Error: LLM_API_KEY is not set in .env file.');
    process.exit(1);
  }

  const workDir = process.cwd();

  console.log(`FirmClaw v5.3.0`);
  console.log(`Model: ${model}`);
  console.log(`API: ${baseURL}`);
  console.log(`WorkDir: ${workDir}`);
  console.log('Type "/help" for commands, "exit" to quit.\n');

  // ──── 2. 初始化组件 ────
  const llm = new LLMClient(apiKey, baseURL, model);

  const tools = new ToolRegistry();
  tools.register(bashTool);
  tools.register(readTool);
  tools.register(writeTool);
  tools.register(editTool);

  // 设置权限策略
  const policy = new DefaultPermissionPolicy({ allowedPaths: [workDir] });
  tools.setPolicy(policy);

  // Phase 3: 初始化会话系统
  const sessionDir = path.join(os.homedir(), '.firmclaw', 'sessions');
  const sessionManager = new SessionManager({ storageDir: sessionDir });
  const contextBuilder = new ContextBuilder({ workDir });
  const tokenCounter = new TokenCounter();

  // Phase 4: 初始化记忆和搜索系统
  const memoryManager = new MemoryManager({ workDir });
  await memoryManager.load();

  const indexDir = path.join(os.homedir(), '.firmclaw', 'index');
  const searchEngine = new SearchEngine({ indexDir });
  await searchEngine.load();

  // Phase 4: 初始化摘要压缩器
  const summarizer = new Summarizer(llm, tokenCounter, {
    summarizeThreshold: 80000,
    maxMessagesToSummarize: 50,
    maxSummaryTokens: 2000,
  });

  // Phase 4: 将 MemoryManager + SearchEngine 注入 ContextBuilder
  contextBuilder.setMemoryManager(memoryManager);
  contextBuilder.setSearchEngine(searchEngine);

  // Phase 4: 将 SearchEngine 注入 SessionManager
  sessionManager.setSearchEngine(searchEngine);

  // v5.3: 初始化子智能体管理器
  const subagentManager = new SubagentManager(llm, tools, {
    systemPrompt: '',
    maxTurns: 5,
    workDir,
    sessionManager,
    contextBuilder,
    tokenCounter,
    trimConfig: {
      maxTokens: 128000,
      maxToolResultTokens: 500,
    },
    summarizer,
  }, {
    maxSubagents: 3,
    defaultTimeoutMs: 120_000,
    defaultMaxTurns: 5,
  });

  const agent = new AgentLoop(llm, tools, {
    systemPrompt: '', // 由 ContextBuilder 动态生成
    maxTurns: 10,
    workDir,
    sessionManager,
    contextBuilder,
    tokenCounter,
    trimConfig: {
      maxTokens: 128000,
      maxToolResultTokens: 500,
    },
    summarizer,
    subagentManager,
  });

  // ──── 3. 启动时自动恢复上次会话 ────
  try {
    const latest = await sessionManager.resumeLatest();
    if (latest) {
      console.log(`Resumed session: ${latest.id} (${latest.title}, ${latest.messageCount} msgs)`);
    }
  } catch {
    // 首次运行无历史会话，忽略
  }

  // ──── 4. 订阅事件流 ────
  const events = agent.getEvents();
  const renderer = new Renderer({ width: process.stdout.columns || 80, color: true });
  const progress = new ProgressIndicator();

  events.on('thinking_delta', (e) => {
    process.stdout.write(e.data as string);
  });

  events.on('tool_start', (e) => {
    const data = e.data as { toolName: string; args: Record<string, unknown> };
    progress.startTool(data.toolName);
    console.log(`\n${renderer.renderToolStart(data.toolName, data.args)}`);
  });

  events.on('tool_end', (e) => {
    const data = e.data as { toolName: string; result: string; isError?: boolean };
    const duration = progress.endTool();
    console.log(`  ${renderer.renderToolEnd(data.toolName, data.result, data.isError)} ${duration}`);
  });

  events.on('error', (e) => {
    console.error(`\n${renderer.renderError(String(e.data))}`);
  });

  events.on('session_start', (e) => {
    const data = e.data as { id: string; title: string };
    console.log(`\n${renderer.renderSystem(`New session started: ${data.id} (${data.title})`)}`);
  });

  events.on('context_trimmed', (e) => {
    const data = e.data as { originalTokens: number; trimmedTokens: number };
    console.log(`\n${renderer.renderSystem(`Context trimmed: ${data.originalTokens.toLocaleString()} → ${data.trimmedTokens.toLocaleString()} tokens`)}`);
  });

  events.on('summary_generated', (e) => {
    const data = e.data as { compressedCount: number; originalTokens: number; newTokens: number };
    console.log(`\n${renderer.renderSystem(`Summary generated: ${data.compressedCount} messages compressed, ${data.originalTokens.toLocaleString()} → ${data.newTokens.toLocaleString()} tokens`)}`);
  });

  events.on('memory_saved', (e) => {
    const data = e.data as { id: string; tag: string };
    console.log(`\n${renderer.renderSystem(`Memory saved: [${data.id}] (${data.tag})`)}`);
  });

  // ──── 5. 启动命令行交互 ────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question('> ', async (input: string) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('\nBye!');
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      // ──── 斜杠命令 ────
      if (trimmed.startsWith('/')) {
        await handleCommand(trimmed);
        prompt();
        return;
      }

      // ──── 普通消息 → agent.run() ────
      console.log('');
      try {
        const result = await agent.run(trimmed);
        console.log(`\n${renderer.renderSeparator()} [${result.turns} turns, ${result.toolCalls} tool calls]${renderer.renderSeparator()}\n`);
      } catch (error: unknown) {
        console.error(`\n[Fatal Error] ${error instanceof Error ? error.message : String(error)}\n`);
      }

      prompt();
    });
  };

  // ──── 6. 斜杠命令处理 ────

  // v5.1: Gateway 服务器实例
  let gateway: GatewayServer | null = null;

  async function handleCommand(cmd: string): Promise<void> {
    const parts = cmd.split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (command) {
      case '/help': {
        console.log(`
Available commands:
  /new              Create a new session
  /resume [id]      Resume session (latest or by ID)
  /sessions         List all sessions
  /session          Show current session info
  /soul             Display SOUL.md content
  /memory [tag]     Display memories (optional: preference/decision/todo/knowledge)
  /remember <text>  Save a memory (auto-classify tag)
  /forget <id>      Delete a memory by ID
  /search <query>   Full-text search across sessions and memories
  /compact          Manually trigger context compression
  /index            Show search index statistics
  /serve [port]     Start WebSocket server (default: 3000)
  /serve stop       Stop WebSocket server
  /serve status     Show server status
  /help             Show this help message
  /exit, /quit      Exit
  Any other text    Send as user message to agent
`);
        break;
      }

      case '/new': {
        const meta = await sessionManager.create(workDir);
        agent.resetSession(meta.id);
        console.log(`New session created: ${meta.id}`);
        break;
      }

      case '/resume': {
        try {
          const meta = arg
            ? await sessionManager.resume(arg)
            : await sessionManager.resumeLatest();
          if (meta) {
            agent.resetSession(meta.id);
            console.log(`Resumed session: ${meta.id} (${meta.title}, ${meta.messageCount} msgs)`);
          } else {
            console.log('No session found.');
          }
        } catch (error: unknown) {
          console.error(`Failed to resume: ${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }

      case '/sessions': {
        const sessions = await sessionManager.listSessions();
        if (sessions.length === 0) {
          console.log('No sessions found.');
        } else {
          console.log(`\nSessions (${sessions.length}):`);
          sessions.forEach((s, i) => {
            const marker = s.id === agent.getCurrentSessionId() ? ' *' : '  ';
            console.log(`${marker}[${i + 1}] ${s.id} | ${s.title} | ${s.messageCount} msgs | ${s.updatedAt}`);
          });
          console.log('  (* = current session)');
        }
        break;
      }

      case '/session': {
        const id = agent.getCurrentSessionId();
        if (id) {
          const meta = await sessionManager.resume(id);
          console.log(JSON.stringify(meta, null, 2));
        } else {
          console.log('No active session.');
        }
        break;
      }

      case '/soul': {
        const soulPath = path.join(workDir, '.firmclaw', 'SOUL.md');
        if (fs.existsSync(soulPath)) {
          console.log(fs.readFileSync(soulPath, 'utf-8'));
        } else {
          console.log('No SOUL.md found. Create one at .firmclaw/SOUL.md');
        }
        break;
      }

      case '/memory': {
        // 支持按标签筛选：/memory preference
        if (arg) {
          const tag = arg.toLowerCase() as MemoryTag;
          const validTags: MemoryTag[] = ['preference', 'decision', 'todo', 'knowledge'];
          if (!validTags.includes(tag)) {
            console.log(`Invalid tag "${arg}". Valid tags: preference, decision, todo, knowledge`);
            break;
          }
          const entries = memoryManager.getByTag(tag);
          if (entries.length === 0) {
            console.log(`No memories with tag "${tag}".`);
          } else {
            console.log(`\nMemories (${tag}):`);
            entries.forEach(e => {
              console.log(`  [${e.id}] ${e.content} (${e.date})`);
            });
          }
        } else {
          const all = memoryManager.getAll();
          if (all.length === 0) {
            console.log('No memories found. Use /remember <text> to save one.');
          } else {
            console.log(`\nAll memories (${all.length}):`);
            const formatted = memoryManager.getFormatted();
            console.log(formatted);
          }
        }
        break;
      }

      case '/remember': {
        if (!arg) {
          console.log('Usage: /remember <text>');
          break;
        }
        // 自动分类标签
        const tag = classifyMemoryTag(arg);
        const entry = await memoryManager.add(tag, arg);
        console.log(`Memory saved: [${entry.id}] ${entry.content}`);
        agent.getEvents().emit('memory_saved', { id: entry.id, tag });
        break;
      }

      case '/forget': {
        if (!arg) {
          console.log('Usage: /forget <id>');
          break;
        }
        const removed = await memoryManager.remove(arg.toUpperCase());
        if (removed) {
          console.log(`Memory deleted: [${arg.toUpperCase()}]`);
        } else {
          console.log(`Memory not found: [${arg.toUpperCase()}]`);
        }
        break;
      }

      case '/search': {
        if (!arg) {
          console.log('Usage: /search <query>');
          break;
        }

        // 搜索会话消息和记忆
        const sessionResults = searchEngine.search(arg, 5);
        const memoryEntries = memoryManager.getAll();
        const memoryIds = searchEngine.searchMemory(arg, memoryEntries, 5);
        const memoryResults = memoryEntries.filter(m => memoryIds.includes(m.id));

        if (sessionResults.length === 0 && memoryResults.length === 0) {
          console.log(`No results for "${arg}".`);
        } else {
          console.log(`\nSearch results for "${arg}":`);

          if (sessionResults.length > 0) {
            console.log(`\n  Sessions:`);
            sessionResults.forEach((r, i) => {
              console.log(`  [${i + 1}] [${r.source}] ${r.snippet} (score: ${r.score})`);
            });
          }

          if (memoryResults.length > 0) {
            console.log(`\n  Memories:`);
            memoryResults.forEach((m, i) => {
              console.log(`  [${i + 1}] [${m.id}] ${m.content} (${m.date})`);
            });
          }
        }
        break;
      }

      case '/compact': {
        try {
          // 获取历史消息并执行摘要
          const historyMessages = agent.getSessionManager()
            ? await agent.getSessionManager()!.getMessages()
            : [];

          if (historyMessages.length === 0) {
            console.log('No messages to compress.');
            break;
          }

          const tokensBefore = tokenCounter.countMessages(historyMessages);

          if (summarizer.shouldSummarize(historyMessages)) {
            const result = await summarizer.summarize(historyMessages);
            if (result.summarized) {
              console.log(`Context compressed: ${result.originalTokens} → ${result.newTokens} tokens (${result.compressedCount} messages)`);
            } else {
              console.log('Context compression not needed (already within threshold).');
            }
          } else {
            console.log(`Context not over threshold (${tokensBefore} tokens < 80000). No compression needed.`);
          }
        } catch (error: unknown) {
          console.error(`Compression failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }

      case '/index': {
        const stats = searchEngine.getStats();
        console.log(`\nSearch Index:`);
        console.log(`  Documents: ${stats.docCount}`);
        console.log(`  Sources:`);
        for (const [source, count] of Object.entries(stats.sources)) {
          console.log(`    - ${source}: ${count}`);
        }
        break;
      }

      // ──── v5.1: Gateway 命令 ────

      case '/serve': {
        if (arg === 'stop') {
          if (gateway) {
            await gateway.stop();
            gateway = null;
            console.log('[Gateway] Server stopped.');
          } else {
            console.log('Gateway is not running.');
          }
          break;
        }

        if (arg === 'status') {
          if (gateway) {
            const status = gateway.getStatus();
            const uptime = Math.round(status.uptime / 1000);
            console.log(`[Gateway] Running: ws://localhost:${status.port} (${status.connections} connections, uptime: ${uptime}s)`);
          } else {
            console.log('Gateway is not running.');
          }
          break;
        }

        // /serve [port]
        const port = parseInt(arg) || 3000;
        if (gateway) {
          const status = gateway.getStatus();
          console.log(`Gateway is already running on port ${status.port}. Use "/serve stop" first.`);
          break;
        }

        // 首次启动时自动生成 token
        const token = AuthGuard.generateToken();
        gateway = new GatewayServer({ port, authToken: token });
        gateway.setLLM(llm);
        gateway.setTools(tools);
        gateway.setSessionManager(sessionManager);
        gateway.setContextBuilder(contextBuilder);
        gateway.setTokenCounter(tokenCounter);
        gateway.setSummarizer(summarizer);
        gateway.setAgentConfig({
          systemPrompt: '',
          maxTurns: 10,
          workDir,
          sessionManager,
          contextBuilder,
          tokenCounter,
          trimConfig: {
            maxTokens: 128000,
            maxToolResultTokens: 500,
          },
          summarizer,
        });

        await gateway.start();
        console.log(`\nConnect with: wscat -c ws://localhost:${port}?token=${token}`);
        break;
      }

      default:
        console.log(`Unknown command: ${cmd}`);
        console.log('Type "/help" for available commands.');
    }
  }

  /**
   * 自动分类记忆标签
   *
   * 简单的关键词匹配策略：
   * - 包含"偏好/喜欢/希望/习惯" → preference
   * - 包含"决定/使用/采用/选择" → decision
   * - 包含"待办/需要/必须/TODO" → todo
   * - 其他 → knowledge
   */
  function classifyMemoryTag(text: string): MemoryTag {
    const lower = text.toLowerCase();
    if (/偏好|喜欢|希望|习惯|prefer|like|wish/.test(lower)) return 'preference';
    if (/决定|使用|采用|选择|decid|chose|using/.test(lower)) return 'decision';
    if (/待办|需要做|必须|todo|need to|must/.test(lower)) return 'todo';
    return 'knowledge';
  }

  prompt();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
