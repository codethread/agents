import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	connectMcpServer,
	createMcpToolDefinitions,
	runMcpSmokeTest,
	type McpStdioServerConfig,
} from "./mcp.js";

const SERVER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-test-server.ts");

function echoServer(name = "echo"): McpStdioServerConfig {
	return { name, transport: "stdio", command: process.execPath, args: [SERVER_PATH] };
}

describe("MCP stdio integration", () => {
	it("connects to a local stdio server and lists namespaced tools", async () => {
		const connection = await connectMcpServer(echoServer());
		try {
			expect(connection.tools).toHaveLength(1);
			const [tool] = connection.tools;
			expect(tool.toolName).toBe("mcp__echo__echo");
			expect(tool.originalName).toBe("echo");
			expect(tool.inputSchema).toMatchObject({ type: "object" });
		} finally {
			await connection.close();
		}
	});

	it("invokes a tool through the generated tool definition", async () => {
		const connection = await connectMcpServer(echoServer());
		try {
			const [definition] = createMcpToolDefinitions(connection);
			const result = await definition.execute({ message: "hello" });
			expect(result.content[0].text).toBe("echo: hello");
			expect(result.details).toMatchObject({ server: "echo", tool: "echo" });
		} finally {
			await connection.close();
		}
	});

	it("smoke tests a server and reports its tools", async () => {
		const results = await runMcpSmokeTest([echoServer("local")]);
		expect(results).toEqual([{ server: echoServer("local"), ok: true, toolNames: ["echo"] }]);
	});

	it("reports a connection failure for an unreachable command", async () => {
		const results = await runMcpSmokeTest(
			[{ name: "broken", transport: "stdio", command: "this-command-does-not-exist", args: [] }],
			{ timeoutMs: 5000 },
		);
		expect(results[0].ok).toBe(false);
		expect(results[0].error).toBeTruthy();
	});
});
