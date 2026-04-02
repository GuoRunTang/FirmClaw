/**
 * src/mcp/tool-adapter.ts
 *
 * MCP Tool -> FirmClaw Tool 适配器。
 *
 * 将 MCP Server 提供的工具转换为 FirmClaw 的 Tool 接口，
 * 使其可以无缝注册到 ToolRegistry，被 AgentLoop 调用。
 *
 * v7.0: 初始实现
 */

import type { Tool, ToolDefinition, ToolParameter } from '../tools/types.js';
import type { ToolContext } from '../tools/context.js';
import type { MCPToolInfo } from './types.js';
import type { MCPClientManager } from './mcp-client-manager.js';

/**
 * 将 MCP JSON Schema 转换为 FirmClaw ToolDefinition
 *
 * MCP 的 inputSchema 遵循 JSON Schema 格式，
 * FirmClaw 的 ToolDefinition 是其子集，基本兼容。
 */
function adaptInputSchema(
  schema: Record<string, unknown>,
): ToolDefinition {
  const schemaObj = schema as Record<string, unknown>;
  const properties = (schemaObj.properties as Record<string, unknown>) || {};
  const required = (schemaObj.required as string[]) || [];

  const adaptedProperties: Record<string, ToolParameter> = {};

  for (const [key, value] of Object.entries(properties)) {
    const prop = value as Record<string, unknown>;
    adaptedProperties[key] = {
      type: (prop.type as string) || 'string',
      description: (prop.description as string) || '',
      enum: prop.enum as string[] | undefined,
      default: prop.default,
    };
  }

  return {
    type: 'object',
    properties: adaptedProperties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/**
 * 将 MCP ToolInfo 转换为 FirmClaw Tool
 *
 * 转换规则：
 * - name: "mcp__<serverName>__<toolName>"
 * - description: "[MCP:<serverName>] <原始描述>"
 * - parameters: MCP inputSchema -> FirmClaw ToolDefinition
 * - execute: 委托给 MCPClientManager.callTool()
 */
export function mcpToolToTool(
  info: MCPToolInfo,
  manager: MCPClientManager,
): Tool {
  const toolName = `mcp__${info.serverName}__${info.toolName}`;

  return {
    name: toolName,
    description: `[MCP:${info.serverName}] ${info.description}`,
    parameters: adaptInputSchema(info.inputSchema),
    execute: async (params: Record<string, unknown>, _context: ToolContext) => {
      const result = await manager.callTool(
        info.serverName,
        info.toolName,
        params,
      );
      return {
        content: result.content,
        isError: result.isError,
      };
    },
  };
}
