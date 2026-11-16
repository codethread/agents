import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, McpServerConfig } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

const configSchema = z.object({
	mcpServers: z.record(z.string(), z.unknown()),
});

export default function mcpConfigExtension(pi: ExtensionAPI) {
	pi.registerFlag("mcp-config", {
		type: "string",
		description: "Load session-only MCP servers from a JSON string or file",
	});
	pi.registerFlag("debug-mcp-config", {
		type: "boolean",
		description: "Print session MCP server names and exposure, then exit",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		const source = pi.getFlag("mcp-config");
		if (typeof source === "string") {
			try {
				const text = source.trimStart().startsWith("{")
					? source
					: readFileSync(resolve(ctx.cwd, source), "utf8");
				const { mcpServers } = configSchema.parse(JSON.parse(text));
				for (const [name, config] of Object.entries(mcpServers)) {
					// Pi validates each unknown server config at the registration boundary.
					pi.registerMcpServer(name, config as McpServerConfig);
				}
			} catch (error) {
				process.stderr.write(
					`mcp-config: ${error instanceof Error ? error.message : String(error)}\n`,
				);
				process.exit(2);
			}
		}

		if (pi.getFlag("debug-mcp-config") === true) {
			process.stdout.write(
				`${JSON.stringify({
					servers: pi.getMcpServers().map(({ name, config }) => ({
						name,
						exposure: config.exposure ?? "codemode",
					})),
				})}\n`,
			);
			process.exit(0);
		}
	});
}
