import { createInterface } from "node:readline";

// Local stdio MCP server: real protocol traffic, no network or external service.
createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	if (id === undefined) return;
	let result;
	switch (method) {
		case "initialize":
			result = {
				protocolVersion: params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "native-mcp-fixture", version: "1.0.0" },
			};
			break;
		case "ping":
			result = {};
			break;
		case "tools/list":
			result = {
				tools: [
					{
						name: "echo",
						description: "Echo the provided value",
						inputSchema: {
							type: "object",
							properties: { value: { type: "string" } },
							required: ["value"],
						},
					},
				],
			};
			break;
		case "tools/call":
			result = { content: [{ type: "text", text: `native-mcp:${params.arguments.value}` }] };
			break;
		default:
			process.stdout.write(
				JSON.stringify({
					jsonrpc: "2.0",
					id,
					error: { code: -32601, message: "Method not found" },
				}) + "\n",
			);
			return;
	}
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
});
