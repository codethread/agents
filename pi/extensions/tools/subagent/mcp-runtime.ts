/**
 * Pi-side glue that connects an agent's configured MCP servers and registers their
 * tools with the running Pi session. Kept separate from `mcp.ts` (which is pure and
 * network-only) so the registration path that depends on the Pi extension API stays
 * isolated.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import type { AgentConfig } from "./agents.js";
import { connectMcpServer, createMcpToolDefinitions, type McpConnection } from "./mcp.js";

export interface AgentMcpSetupResult {
	/** Namespaced tool names registered with Pi. */
	toolNames: string[];
	/** Live connections to close when the session shuts down. */
	connections: McpConnection[];
	/** Non-fatal connection failures (for example, headless auth rejections). */
	warnings: string[];
}

/**
 * Connect every server declared by `agent.mcpServers`, registering each remote tool
 * under its `mcp__<server>__<tool>` name. Connection failures are returned as warnings
 * rather than thrown, so an adopted agent can still run with whatever connected.
 */
export async function setupAgentMcpServers(
	pi: ExtensionAPI,
	agent: AgentConfig,
	options: { timeoutMs?: number } = {},
): Promise<AgentMcpSetupResult> {
	const toolNames: string[] = [];
	const connections: McpConnection[] = [];
	const warnings: string[] = [];

	for (const server of agent.mcpServers ?? []) {
		try {
			const connection = await connectMcpServer(server, options);
			connections.push(connection);
			for (const def of createMcpToolDefinitions(connection)) {
				pi.registerTool({
					name: def.name,
					label: def.label,
					description: def.description,
					promptSnippet: def.description,
					parameters: def.parameters as unknown as TSchema,
					async execute(_toolCallId, params, signal) {
						return def.execute(params, signal);
					},
				});
				toolNames.push(def.name);
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			warnings.push(
				`MCP server "${server.name}" for agent "${agent.name}" failed to connect: ${reason}`,
			);
		}
	}

	return { toolNames, connections, warnings };
}

export async function closeMcpConnections(connections: McpConnection[]): Promise<void> {
	await Promise.all(connections.map((connection) => connection.close()));
}
