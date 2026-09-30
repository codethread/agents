/** Registers agent-local MCP definitions with Pi's built-in MCP runtime. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.js";

type McpApi = Pick<
	ExtensionAPI,
	"registerMcpServer" | "unregisterMcpServer" | "getMcpServers" | "getAllTools"
>;

export interface AgentMcpSetupResult {
	toolNames: string[];
	registrations: string[];
}

export function setupAgentMcpServers(pi: McpApi, agent: AgentConfig): AgentMcpSetupResult {
	const servers = agent.mcpServers ?? [];
	if (servers.length === 0) return { toolNames: [], registrations: [] };
	if (!pi.getAllTools().some((tool) => tool.name === "codemode")) {
		throw new Error(
			`Agent "${agent.name}" declares MCP servers, but Pi's codemode tool is not loaded. Enable builtin:codemode and builtin:mcp.`,
		);
	}

	const existingNames = new Set(pi.getMcpServers().map((server) => server.name));
	for (const { name } of servers) {
		if (existingNames.has(name)) {
			throw new Error(`Agent "${agent.name}" MCP server "${name}" is already registered`);
		}
	}

	const registrations: string[] = [];
	try {
		for (const { name, ...definition } of servers) {
			pi.registerMcpServer(name, { ...definition, exposure: "codemode" });
			registrations.push(name);
		}
	} catch (error) {
		disposeMcpRegistrations(pi, registrations);
		throw error;
	}
	return { toolNames: ["codemode"], registrations };
}

export function disposeMcpRegistrations(
	pi: Pick<ExtensionAPI, "unregisterMcpServer">,
	registrations: string[],
): void {
	for (const name of registrations) pi.unregisterMcpServer(name);
}
