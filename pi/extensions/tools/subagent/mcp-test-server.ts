/**
 * Minimal stdio MCP server used only by `mcp.integration.test.ts`.
 *
 * Exposes a single `echo` tool. Run as: `node mcp-test-server.js`.
 * Uses the low-level Server API with raw JSON Schema to avoid coupling the test
 * to any particular schema/validation library.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{ name: "echo-test-server", version: "0.0.1" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "echo",
			description: "Echo back the provided message",
			inputSchema: {
				type: "object",
				properties: { message: { type: "string" } },
				required: ["message"],
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	if (request.params.name !== "echo") {
		return {
			content: [{ type: "text", text: `unknown tool ${request.params.name}` }],
			isError: true,
		};
	}
	const message = String((request.params.arguments as { message?: unknown })?.message ?? "");
	return { content: [{ type: "text", text: `echo: ${message}` }] };
});

await server.connect(new StdioServerTransport());
