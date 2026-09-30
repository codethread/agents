import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "./agents.js";
import { disposeMcpRegistrations, setupAgentMcpServers } from "./mcp-runtime.js";

const agent: AgentConfig = {
	name: "docs",
	description: "Documentation",
	hidden: false,
	tools: ["read"],
	systemPrompt: "Find docs.",
	source: "project",
	filePath: "/tmp/docs.md",
	mcpServers: [{ name: "docs", command: "node", args: ["server.mjs"] }],
};

function api() {
	return {
		registerMcpServer: vi.fn(),
		unregisterMcpServer: vi.fn(),
		getMcpServers: vi.fn().mockReturnValue([]),
		getAllTools: vi.fn().mockReturnValue([{ name: "codemode" }]),
	};
}

describe("agent-native MCP registration", () => {
	it("registers compact native servers and grants codemode", () => {
		const pi = api();
		const setup = setupAgentMcpServers(pi, agent);
		expect(setup).toEqual({ toolNames: ["codemode"], registrations: ["docs"] });
		expect(pi.registerMcpServer).toHaveBeenCalledWith("docs", {
			command: "node",
			args: ["server.mjs"],
			exposure: "codemode",
		});
		disposeMcpRegistrations(pi, setup.registrations);
		expect(pi.unregisterMcpServer).toHaveBeenCalledWith("docs");
	});

	it("leaves agents without servers unchanged", () => {
		const pi = api();
		expect(setupAgentMcpServers(pi, { ...agent, mcpServers: [] })).toEqual({
			toolNames: [],
			registrations: [],
		});
		expect(pi.registerMcpServer).not.toHaveBeenCalled();
	});

	it("reports missing codemode instead of registering inaccessible servers", () => {
		const pi = api();
		pi.getAllTools.mockReturnValue([]);
		expect(() => setupAgentMcpServers(pi, agent)).toThrow("codemode tool is not loaded");
		expect(pi.registerMcpServer).not.toHaveBeenCalled();
	});

	it("does not overwrite an existing registration, including the selected agent's", () => {
		const pi = api();
		pi.getMcpServers.mockReturnValue([{ name: "docs" }]);
		expect(() => setupAgentMcpServers(pi, agent)).toThrow('server "docs" is already registered');
		expect(pi.registerMcpServer).not.toHaveBeenCalled();
		expect(pi.unregisterMcpServer).not.toHaveBeenCalled();
	});

	it("rolls back its earlier registrations when a later registration fails", () => {
		const pi = api();
		pi.registerMcpServer
			.mockImplementationOnce(() => {})
			.mockImplementationOnce(() => {
				throw new Error("registration failed");
			});
		expect(() =>
			setupAgentMcpServers(pi, {
				...agent,
				mcpServers: [...agent.mcpServers!, { name: "second", command: "node" }],
			}),
		).toThrow("registration failed");
		expect(pi.unregisterMcpServer.mock.calls).toEqual([["docs"]]);
	});
});
