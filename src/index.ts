/**
 * src/index.ts
 *
 * 程序入口文件。
 *
 * v1.0: 初始 CLI（基础 ReAct 循环 + bash 工具）
 * v1.6: 注册全部 4 工具 + 权限策略
 * v2.4: 集成 Phase 3 全部模块（会话管理 + 动态提示词 + 上下文裁剪 + 斜杠命令）
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

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  // ──── 1. 加载配置 ────
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL || 'https://api.minimax.chat/v1';
  const model = process.env.LLM_MODEL || 'MiniMax-M2.7';

  if (!apiKey) {
    console.error('Error: LLM_API_KEY is not set in .env file.');
    process.exit(1);
  }

  const workDir = process.cwd();

  console.log(`FirmClaw v2.4.0`);
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

  events.on('thinking_delta', (e) => {
    process.stdout.write(e.data as string);
  });

  events.on('tool_start', (e) => {
    const data = e.data as { toolName: string; args: Record<string, unknown> };
    console.log(`\n>>> [${data.toolName}] ${JSON.stringify(data.args)}`);
  });

  events.on('tool_end', (e) => {
    const data = e.data as { toolName: string; result: string };
    const preview = data.result.length > 300
      ? data.result.substring(0, 300) + '...(truncated)'
      : data.result;
    console.log(`<<< [${data.toolName}] ${preview}`);
  });

  events.on('error', (e) => {
    console.error(`\n[Error] ${e.data}`);
  });

  events.on('session_start', (e) => {
    const data = e.data as { id: string; title: string };
    console.log(`\n[System] New session started: ${data.id} (${data.title})`);
  });

  events.on('context_trimmed', (e) => {
    const data = e.data as { originalTokens: number; trimmedTokens: number };
    console.log(`\n[System] Context trimmed: ${data.originalTokens} → ${data.trimmedTokens} tokens`);
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
        console.log(`\n--- [${result.turns} turns, ${result.toolCalls} tool calls] ---\n`);
      } catch (error: unknown) {
        console.error(`\n[Fatal Error] ${error instanceof Error ? error.message : String(error)}\n`);
      }

      prompt();
    });
  };

  // ──── 6. 斜杠命令处理 ────
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
  /memory           Display MEMORY.md content
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
        const memPath = path.join(workDir, '.firmclaw', 'MEMORY.md');
        if (fs.existsSync(memPath)) {
          console.log(fs.readFileSync(memPath, 'utf-8'));
        } else {
          console.log('No MEMORY.md found.');
        }
        break;
      }

      default:
        console.log(`Unknown command: ${cmd}`);
        console.log('Type "/help" for available commands.');
    }
  }

  prompt();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
