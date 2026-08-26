/** Registers agent-local MCP definitions with the installed pi-mcp-adapter. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import type { McpServerConfig } from "./mcp.js";

const MCP_RUNTIME_REGISTER_EVENT = "pi-mcp-adapter:runtime-register:v1";

interface McpServerRegistration {
	dispose(): Promise<void>;
}

interface RuntimeRegistrationRequest {
	version: 1;
	name: string;
	definition: Omit<McpServerConfig, "name">;
	result?: { ok: true; registration: McpServerRegistration } | { ok: false; error: Error };
}

export interface AgentMcpSetupResult {
	toolNames: string[];
	registrations: McpServerRegistration[];
}

export async function setupAgentMcpServers(
	pi: ExtensionAPI,
	agent: AgentConfig,
): Promise<AgentMcpSetupResult> {
	const servers = agent.mcpServers ?? [];
	if (servers.length === 0) return { toolNames: [], registrations: [] };

	const registrations: McpServerRegistration[] = [];
	try {
		for (const { name, ...definition } of servers) {
			const request: RuntimeRegistrationRequest = { version: 1, name, definition };
			pi.events.emit(MCP_RUNTIME_REGISTER_EVENT, request);
			if (!request.result) {
				throw new Error(
					`Agent "${agent.name}" declares MCP server "${name}", but pi-mcp-adapter is not installed`,
				);
			}
			if (!request.result.ok) throw request.result.error;
			registrations.push(request.result.registration);
		}
	} catch (error) {
		await disposeMcpRegistrations(registrations);
		throw error;
	}

	// Runtime registrations are intentionally proxy-only. Expose the adapter's
	// compact single-call and scripting surfaces rather than every MCP tool.
	return { toolNames: ["mcp", "mcpScript"], registrations };
}

export async function disposeMcpRegistrations(
	registrations: McpServerRegistration[],
): Promise<void> {
	await Promise.all(registrations.map((registration) => registration.dispose()));
}
