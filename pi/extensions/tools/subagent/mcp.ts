/**
 * Parses agent-local MCP frontmatter into Pi-native server definitions.
 * Connections, authentication, tool discovery and execution belong to Pi's
 * built-in MCP extension.
 */

export interface McpRemoteServerConfig {
	name: string;
	url: string;
	headers?: Record<string, string>;
	type?: "http";
}

export interface McpStdioServerConfig {
	name: string;
	command: string;
	type?: "stdio";
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
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
	if (!/^[A-Za-z0-9_-]+$/.test(name)) {
		throw new Error(`invalid server name "${name}"; use letters, digits, "_" and "-"`);
	}
	const config = entry[keys[0]!];
	if (!isRecord(config)) throw new Error(`server "${name}" config must be a map of settings`);

	const hasCommand = "command" in config;
	const hasRemote = "url" in config;
	if (hasCommand && hasRemote) {
		throw new Error(`server "${name}" mixes stdio and remote fields; use one transport`);
	}

	if (hasCommand) {
		assertNoUnknownKeys(name, config, new Set(["command", "type", "args", "env", "cwd"]));
		if (config.type !== undefined && config.type !== "stdio") {
			throw new Error(`server "${name}" has unsupported type "${config.type}" for stdio`);
		}
		if (config.cwd !== undefined && typeof config.cwd !== "string") {
			throw new Error(`server "${name}" cwd must be a string`);
		}
		if (typeof config.command !== "string" || !config.command.trim()) {
			throw new Error(`server "${name}" requires a non-empty "command"`);
		}
		const args = parseStringArray(name, config.args, "args");
		const env = parseStringRecord(name, config.env, "env");
		return {
			name,
			command: config.command.trim(),
			...(config.type === "stdio" ? { type: "stdio" } : {}),
			...(args ? { args } : {}),
			...(env ? { env } : {}),
			...(config.cwd !== undefined ? { cwd: config.cwd as string } : {}),
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

	if (config.type === "sse") {
		throw new Error(
			`server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`,
		);
	}
	if (config.type !== undefined && config.type !== "http" && config.type !== "streamable-http") {
		throw new Error(`server "${name}" has unsupported type "${config.type}"`);
	}
	const headers = parseStringRecord(name, config.headers, "headers");
	return {
		name,
		url,
		...(headers ? { headers } : {}),
		...(config.type !== undefined ? { type: "http" as const } : {}),
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
		: `${server.type ?? "http"}: ${server.url}`;
}
