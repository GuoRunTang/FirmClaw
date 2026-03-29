/**
 * src/session/types.ts
 *
 * 会话系统的类型定义。
 *
 * v2.1: 基础会话类型 —— SessionMeta / StoredMessage / SessionConfig
 * v4.5: SessionMeta 新增 parentSessionId / branchPoint
 */

/** 会话元数据（存储在 JSONL 文件首行 #META） */
export interface SessionMeta {
  /** 会话唯一 ID（crypto.randomUUID() 格式） */
  id: string;
  /** 会话创建时间（ISO 8601） */
  createdAt: string;
  /** 最后活跃时间（ISO 8601） */
  updatedAt: string;
  /** 关联的工作目录 */
  workDir: string;
  /** 会话标题（用户第一条消息的前 50 字，自动生成） */
  title: string;
  /** 消息条数 */
  messageCount: number;
  /** v4.5: 父会话 ID（分支来源） */
  parentSessionId?: string;
  /** v4.5: 分支点消息序号（从第几条消息开始分叉） */
  branchPoint?: number;
}

/** 存储的单条消息（JSONL 一行） */
export interface StoredMessage {
  /** 消息角色 */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 消息内容 */
  content: string;
  /** 工具调用 ID（仅 tool 角色） */
  tool_call_id?: string;
  /** 工具调用列表（仅 assistant 角色） */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** 时间戳（ISO 8601） */
  timestamp: string;
}

/** 会话管理器配置 */
export interface SessionConfig {
  /** 会话存储根目录，默认 ~/.firmclaw/sessions */
  storageDir?: string;
  /** 是否启用会话持久化（默认 true，测试时可关闭） */
  enabled?: boolean;
}
