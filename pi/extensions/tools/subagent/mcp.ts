/**
 * Parses agent-local MCP frontmatter into pi-mcp-adapter server definitions.
 *
 * The subagent extension owns only this compatibility boundary. Connections,
 * authentication, discovery, calls, output guarding, and shutdown are delegated
 * to pi-mcp-adapter through its runtime-registration event.
 */

export interface McpRemoteServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
	httpTransport?: "streamable-http" | "sse";
}

export interface McpStdioServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export type McpServerConfig = McpRemoteServerConfig | McpStdioServerConfig;

export interface ParsedMcpServers {
	servers: McpServerConfig[];
	error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUnknownKeys(
	serverName: string,
	config: Record<string, unknown>,
	allowed: Set<string>,
): void {
	const unknownKeys = Object.keys(config).filter((key) => !allowed.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`server "${serverName}" has unknown key(s): ${unknownKeys.join(", ")}`);
	}
}

function parseStringArray(serverName: string, value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`server "${serverName}" ${field} must be a list of strings`);
	}
	return value;
}

function parseStringRecord(
	serverName: string,
	value: unknown,
	field: string,
): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new Error(
			`server "${serverName}" ${field} must be a map of string keys to string values`,
		);
	}
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") {
			throw new Error(`server "${serverName}" ${field}."${key}" must be a string`);
		}
	}
	return value as Record<string, string>;
}

function parseServerEntry(entry: unknown): McpServerConfig {
	if (!isRecord(entry)) {
		throw new Error("each mcpServers entry must be a single-key map of server name to config");
	}
	const keys = Object.keys(entry);
	if (keys.length !== 1) {
		throw new Error(`each mcpServers entry must have exactly one server-name key`);
	}
	const name = keys[0]!.trim();
	if (!name) throw new Error("server name must be a non-empty string");
	const config = entry[keys[0]!];
	if (!isRecord(config)) throw new Error(`server "${name}" config must be a map of settings`);

	const hasCommand = "command" in config;
	const hasRemote = "url" in config || "type" in config;
	if (hasCommand && hasRemote) {
		throw new Error(`server "${name}" mixes stdio and remote fields; use one transport`);
	}

	if (hasCommand) {
		assertNoUnknownKeys(name, config, new Set(["command", "args", "env"]));
		if (typeof config.command !== "string" || !config.command.trim()) {
			throw new Error(`server "${name}" requires a non-empty "command"`);
		}
		const args = parseStringArray(name, config.args, "args");
		const env = parseStringRecord(name, config.env, "env");
		return {
			name,
			command: config.command.trim(),
			...(args ? { args } : {}),
			...(env ? { env } : {}),
		};
	}

	assertNoUnknownKeys(name, config, new Set(["type", "url", "headers"]));
	if (typeof config.url !== "string" || !config.url.trim()) {
		throw new Error(`server "${name}" requires a non-empty "url"`);
	}
	const url = config.url.trim();
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		throw new Error(`server "${name}" url "${url}" is not a valid URL`);
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(`server "${name}" url "${url}" must use http or https`);
	}

	let httpTransport: "streamable-http" | "sse" | undefined;
	if (config.type !== undefined) {
		if (typeof config.type !== "string") throw new Error(`server "${name}" type must be a string`);
		const type = config.type.trim().toLowerCase();
		if (["http", "streamable-http", "streamable_http", "streamablehttp"].includes(type)) {
			httpTransport = "streamable-http";
		} else if (type === "sse") {
			httpTransport = "sse";
		} else {
			throw new Error(`server "${name}" has unsupported type "${config.type}"`);
		}
	}
	const headers = parseStringRecord(name, config.headers, "headers");
	return {
		name,
		url,
		...(headers ? { headers } : {}),
		...(httpTransport ? { httpTransport } : {}),
	};
}

export function parseMcpServers(
	value: unknown,
	agentName: string,
	filePath: string,
): ParsedMcpServers {
	if (value === undefined || value === null) return { servers: [] };
	try {
		if (isRecord(value)) {
			throw new Error("mcpServers must be a YAML list, not a map; prefix each server with '- '");
		}
		if (!Array.isArray(value)) throw new Error("mcpServers must be a list");
		if (value.length === 0) throw new Error("mcpServers must not be empty when present");
		const servers = value.map(parseServerEntry);
		const names = new Set<string>();
		for (const server of servers) {
			if (names.has(server.name)) throw new Error(`duplicate server name "${server.name}"`);
			names.add(server.name);
		}
		return { servers };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			servers: [],
			error: `Invalid mcpServers for agent "${agentName}" at ${filePath}: ${reason}`,
		};
	}
}

export function describeMcpServer(server: McpServerConfig): string {
	return "command" in server
		? `stdio: ${[server.command, ...(server.args ?? [])].join(" ")}`
		: `${server.httpTransport ?? "http"}: ${server.url}`;
}
