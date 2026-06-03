/**
 * MCP (Model Context Protocol) server support for subagents.
 *
 * Parses Claude Code-style `mcpServers` frontmatter (a YAML list of single-key
 * maps), connects to remote (HTTP/SSE) and local (stdio) MCP servers, and exposes
 * their tools to an adopted/spawned agent under an `mcp__<server>__<tool>` namespace.
 *
 * Parsing is pure and dependency-free so it can be unit tested without a network.
 * Connection helpers wrap the official `@modelcontextprotocol/sdk` client.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpRemoteServerConfig {
	name: string;
	transport: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
}

export interface McpStdioServerConfig {
	name: string;
	transport: "stdio";
	command: string;
	args: string[];
	env?: Record<string, string>;
}

export type McpServerConfig = McpRemoteServerConfig | McpStdioServerConfig;

export interface ParsedMcpServers {
	servers: McpServerConfig[];
	error?: string;
}

export interface McpToolInfo {
	serverName: string;
	/** Namespaced tool name exposed to Pi (`mcp__<server>__<tool>`). */
	toolName: string;
	/** Original tool name on the MCP server. */
	originalName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpConnection {
	config: McpServerConfig;
	client: Client;
	tools: McpToolInfo[];
	close: () => Promise<void>;
}

const REMOTE_TYPE_ALIASES: Record<string, "http" | "sse"> = {
	http: "http",
	"streamable-http": "http",
	streamable_http: "http",
	streamablehttp: "http",
	sse: "sse",
};

const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 20_000;

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
	if (!Array.isArray(value)) {
		throw new Error(`server "${serverName}" ${field} must be a list of strings`);
	}
	return value.map((item) => {
		if (typeof item !== "string") {
			throw new Error(`server "${serverName}" ${field} must contain only strings`);
		}
		return item;
	});
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
	const result: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== "string") {
			throw new Error(`server "${serverName}" ${field}."${key}" must be a string`);
		}
		result[key] = raw;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function unwrapServerEntry(entry: unknown): {
	name: string;
	config: Record<string, unknown>;
} {
	if (!isRecord(entry)) {
		throw new Error(
			"each mcpServers entry must be a single-key map of server name to config (a YAML list item)",
		);
	}
	const keys = Object.keys(entry);
	if (keys.length !== 1) {
		throw new Error(
			`each mcpServers entry must have exactly one server-name key, but found ${keys.length} (${keys.join(", ") || "none"})`,
		);
	}
	const name = keys[0]!.trim();
	if (!name) throw new Error("server name must be a non-empty string");
	const config = entry[name];
	if (!isRecord(config)) {
		throw new Error(`server "${name}" config must be a map of settings`);
	}
	return { name, config };
}

function parseRemoteConfig(name: string, config: Record<string, unknown>): McpRemoteServerConfig {
	assertNoUnknownKeys(name, config, new Set(["type", "url", "headers"]));

	const { url } = config;
	if (typeof url !== "string" || !url.trim()) {
		throw new Error(`server "${name}" requires a non-empty "url"`);
	}

	let transport: "http" | "sse" = "http";
	if (config.type !== undefined) {
		if (typeof config.type !== "string") {
			throw new Error(`server "${name}" type must be a string`);
		}
		const mapped = REMOTE_TYPE_ALIASES[config.type.trim().toLowerCase()];
		if (!mapped) {
			throw new Error(
				`server "${name}" has unsupported type "${config.type}" (expected "http" or "sse")`,
			);
		}
		transport = mapped;
	}

	const trimmedUrl = url.trim();
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(trimmedUrl);
	} catch {
		throw new Error(`server "${name}" url "${trimmedUrl}" is not a valid URL`);
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error(
			`server "${name}" url "${trimmedUrl}" must use http or https, not ${parsedUrl.protocol}`,
		);
	}

	const headers = parseStringRecord(name, config.headers, "headers");
	return { name, transport, url: trimmedUrl, ...(headers ? { headers } : {}) };
}

function parseStdioConfig(name: string, config: Record<string, unknown>): McpStdioServerConfig {
	assertNoUnknownKeys(name, config, new Set(["command", "args", "env"]));

	const { command } = config;
	if (typeof command !== "string" || !command.trim()) {
		throw new Error(`server "${name}" requires a non-empty "command"`);
	}

	const args = parseStringArray(name, config.args, "args");
	const env = parseStringRecord(name, config.env, "env");
	return {
		name,
		transport: "stdio",
		command: command.trim(),
		args: args ?? [],
		...(env ? { env } : {}),
	};
}

function parseServerConfig(name: string, config: Record<string, unknown>): McpServerConfig {
	const hasCommand = "command" in config;
	const hasRemote = "url" in config || "type" in config;

	if (hasCommand && hasRemote) {
		throw new Error(
			`server "${name}" mixes stdio ("command") and remote ("type"/"url") fields; use one transport`,
		);
	}
	if (hasCommand) return parseStdioConfig(name, config);
	if (hasRemote) return parseRemoteConfig(name, config);
	throw new Error(
		`server "${name}" must declare either "command" (stdio) or "url" (remote http/sse)`,
	);
}

function parseMcpServerList(value: unknown): McpServerConfig[] {
	if (isRecord(value)) {
		throw new Error(
			"mcpServers must be a YAML list of single-key server entries, not a map; prefix each server with '- '",
		);
	}
	if (!Array.isArray(value)) {
		throw new Error("mcpServers must be a list of single-key server entries");
	}
	if (value.length === 0) {
		throw new Error("mcpServers must not be empty when present");
	}

	const servers: McpServerConfig[] = [];
	const seen = new Set<string>();
	const seenNamespaces = new Map<string, string>();
	for (const entry of value) {
		const { name, config } = unwrapServerEntry(entry);
		if (seen.has(name)) {
			throw new Error(`duplicate server name "${name}"`);
		}
		seen.add(name);
		const namespace = sanitizeMcpName(name);
		const collidingName = seenNamespaces.get(namespace);
		if (collidingName !== undefined) {
			throw new Error(
				`server "${name}" collides with server "${collidingName}": both resolve to the tool namespace "mcp__${namespace}__"`,
			);
		}
		seenNamespaces.set(namespace, name);
		servers.push(parseServerConfig(name, config));
	}
	return servers;
}

/**
 * Parse the `mcpServers` frontmatter value for one agent.
 *
 * Returns parsed servers, or an `error` string describing the first malformed entry.
 * Never throws so a single bad agent file does not abort discovery.
 */
export function parseMcpServers(
	value: unknown,
	agentName: string,
	filePath: string,
): ParsedMcpServers {
	if (value === undefined || value === null) return { servers: [] };
	try {
		return { servers: parseMcpServerList(value) };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			servers: [],
			error: `Invalid mcpServers for agent "${agentName}" at ${filePath}: ${reason}`,
		};
	}
}

export function sanitizeMcpName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "server";
}

export function mcpToolName(serverName: string, toolName: string): string {
	return `mcp__${sanitizeMcpName(serverName)}__${toolName}`;
}

function normalizeInputSchema(schema: unknown): Record<string, unknown> {
	if (isRecord(schema) && schema.type === "object") {
		return schema as Record<string, unknown>;
	}
	return { type: "object", properties: {} };
}

function createTransport(config: McpServerConfig): Transport {
	if (config.transport === "stdio") {
		return new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: config.env ? { ...getDefaultEnvironment(), ...config.env } : undefined,
			stderr: "ignore",
		});
	}

	const url = new URL(config.url);
	const requestInit = config.headers ? { headers: config.headers } : undefined;
	if (config.transport === "sse") {
		return new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
	}
	return new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Connect to one MCP server and list its tools.
 *
 * Throws a descriptive error on connection/list failure (for example, an
 * authentication/authorization rejection from a remote server). Callers decide
 * whether that is fatal (smoke test) or a non-fatal warning (agent adoption).
 */
export async function connectMcpServer(
	config: McpServerConfig,
	options: { timeoutMs?: number } = {},
): Promise<McpConnection> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS;
	const client = new Client({ name: "pi-subagent-mcp", version: "0.1.0" }, { capabilities: {} });
	const transport = createTransport(config);

	try {
		await withTimeout(client.connect(transport), timeoutMs, `MCP connect to "${config.name}"`);
		const listed = await withTimeout(
			client.listTools(),
			timeoutMs,
			`MCP listTools for "${config.name}"`,
		);
		const tools: McpToolInfo[] = listed.tools.map((tool) => ({
			serverName: config.name,
			toolName: mcpToolName(config.name, tool.name),
			originalName: tool.name,
			description: tool.description ?? "",
			inputSchema: normalizeInputSchema(tool.inputSchema),
		}));
		return {
			config,
			client,
			tools,
			close: async () => {
				try {
					await client.close();
				} catch {
					// Best-effort cleanup; closing a half-open transport may throw.
				}
			},
		};
	} catch (error) {
		try {
			await client.close();
		} catch {
			// ignore close failures during error unwinding
		}
		throw error instanceof Error ? error : new Error(String(error));
	}
}

export interface McpToolExecuteResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
}

export interface McpToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (params: unknown, signal?: AbortSignal) => Promise<McpToolExecuteResult>;
}

interface McpContentPart {
	type?: string;
	text?: string;
	[key: string]: unknown;
}

export function mcpContentToText(result: unknown): { text: string; isError: boolean } {
	if (!isRecord(result)) return { text: "", isError: false };
	const isError = result.isError === true;
	const content = result.content;
	const parts: string[] = [];
	if (Array.isArray(content)) {
		parts.push(
			...content.map((part: McpContentPart) => {
				if (part?.type === "text" && typeof part.text === "string") return part.text;
				if (part?.type === "resource_link" && typeof part.uri === "string") {
					return `[resource] ${String(part.name ?? part.uri)}: ${part.uri}`;
				}
				return JSON.stringify(part);
			}),
		);
	} else if (typeof result.toolResult !== "undefined") {
		parts.push(JSON.stringify(result.toolResult, null, 2));
	}
	if (typeof result.structuredContent !== "undefined") {
		parts.push(JSON.stringify(result.structuredContent, null, 2));
	}
	return { text: parts.join("\n"), isError };
}

/**
 * Build Pi-compatible tool definitions for every tool on a live MCP connection.
 *
 * Each tool proxies `callTool` to the MCP server. MCP tool errors are thrown so Pi
 * marks the tool result as an error (returning a value never sets the error flag).
 */
export function createMcpToolDefinitions(connection: McpConnection): McpToolDefinition[] {
	return connection.tools.map((tool) => ({
		name: tool.toolName,
		label: `${tool.serverName}: ${tool.originalName}`,
		description:
			tool.description || `MCP tool "${tool.originalName}" from server "${tool.serverName}"`,
		parameters: tool.inputSchema,
		execute: async (params: unknown, signal?: AbortSignal): Promise<McpToolExecuteResult> => {
			const callArgs = isRecord(params) ? params : {};
			const response = await connection.client.callTool(
				{ name: tool.originalName, arguments: callArgs },
				undefined,
				signal ? { signal } : undefined,
			);
			const { text, isError } = mcpContentToText(response);
			if (isError) {
				throw new Error(text || `MCP tool "${tool.originalName}" reported an error`);
			}
			return {
				content: [{ type: "text", text: text || "(no output)" }],
				details: { server: tool.serverName, tool: tool.originalName },
			};
		},
	}));
}

export interface McpSmokeResult {
	server: McpServerConfig;
	ok: boolean;
	toolNames?: string[];
	error?: string;
}

/**
 * Attempt to connect to each server and list tools, closing the connection after.
 * Used by the `/debug-mcp` command and `--debug-mcp` flag as a headless smoke test.
 */
export async function runMcpSmokeTest(
	servers: McpServerConfig[],
	options: { timeoutMs?: number } = {},
): Promise<McpSmokeResult[]> {
	const results: McpSmokeResult[] = [];
	for (const server of servers) {
		try {
			const connection = await connectMcpServer(server, options);
			results.push({
				server,
				ok: true,
				toolNames: connection.tools.map((tool) => tool.originalName),
			});
			await connection.close();
		} catch (error) {
			results.push({
				server,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return results;
}

function describeServer(server: McpServerConfig): string {
	if (server.transport === "stdio") {
		return `stdio: ${[server.command, ...server.args].join(" ")}`;
	}
	return `${server.transport}: ${server.url}`;
}

export function formatMcpSmokeReport(agentName: string, results: McpSmokeResult[]): string {
	if (results.length === 0) {
		return `Agent "${agentName}" declares no MCP servers.`;
	}
	const lines = [`MCP smoke test for agent "${agentName}":`, ""];
	for (const result of results) {
		lines.push(`## ${result.server.name} (${describeServer(result.server)})`);
		if (result.ok) {
			const tools = result.toolNames ?? [];
			lines.push(`- status: connected`);
			lines.push(`- tools (${tools.length}): ${tools.join(", ") || "(none)"}`);
		} else {
			lines.push(`- status: error`);
			lines.push(`- error: ${result.error}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}
