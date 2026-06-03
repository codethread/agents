import { describe, expect, it } from "vitest";
import {
	formatMcpSmokeReport,
	mcpContentToText,
	mcpToolName,
	parseMcpServers,
	sanitizeMcpName,
	type McpServerConfig,
} from "./mcp.js";

const AGENT = "jira-mcp";
const FILE = "/tmp/jira-mcp.md";

function parse(value: unknown) {
	return parseMcpServers(value, AGENT, FILE);
}

describe("parseMcpServers", () => {
	it("returns no servers when the field is absent", () => {
		expect(parse(undefined)).toEqual({ servers: [] });
		expect(parse(null)).toEqual({ servers: [] });
	});

	it("parses a remote http server from a single-key list entry", () => {
		const result = parse([
			{ atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" } },
		]);
		expect(result.error).toBeUndefined();
		expect(result.servers).toEqual([
			{ name: "atlassian", transport: "http", url: "https://mcp.atlassian.com/v1/mcp" },
		]);
	});

	it("defaults remote transport to http when type is omitted but url is present", () => {
		const result = parse([{ remote: { url: "https://example.com/mcp" } }]);
		expect(result.servers[0]).toMatchObject({ name: "remote", transport: "http" });
	});

	it("maps streamable-http and sse type aliases", () => {
		expect(parse([{ a: { type: "streamable-http", url: "https://x" } }]).servers[0]).toMatchObject({
			transport: "http",
		});
		expect(parse([{ a: { type: "SSE", url: "https://x" } }]).servers[0]).toMatchObject({
			transport: "sse",
		});
	});

	it("parses remote headers", () => {
		const result = parse([
			{ a: { type: "http", url: "https://x", headers: { Authorization: "Bearer t" } } },
		]);
		expect(result.servers[0]).toMatchObject({ headers: { Authorization: "Bearer t" } });
	});

	it("parses a stdio command server with args and env", () => {
		const result = parse([
			{
				context7: {
					command: "npx",
					args: ["-y", "@upstash/context7-mcp"],
					env: { TOKEN: "abc" },
				},
			},
		]);
		expect(result.error).toBeUndefined();
		expect(result.servers[0]).toEqual({
			name: "context7",
			transport: "stdio",
			command: "npx",
			args: ["-y", "@upstash/context7-mcp"],
			env: { TOKEN: "abc" },
		});
	});

	it("defaults stdio args to an empty array", () => {
		const result = parse([{ local: { command: "my-server" } }]);
		expect(result.servers[0]).toEqual({
			name: "local",
			transport: "stdio",
			command: "my-server",
			args: [],
		});
	});

	it("parses multiple servers", () => {
		const result = parse([
			{ atlassian: { type: "http", url: "https://x" } },
			{ context7: { command: "npx", args: ["-y", "c7"] } },
		]);
		expect(result.servers.map((s) => s.name)).toEqual(["atlassian", "context7"]);
	});

	it("rejects a map form with a clear message", () => {
		const result = parse({ atlassian: { url: "https://x" } });
		expect(result.servers).toEqual([]);
		expect(result.error).toContain("YAML list");
	});

	it("rejects an empty list", () => {
		expect(parse([]).error).toContain("must not be empty");
	});

	it("rejects entries with more than one key", () => {
		const result = parse([{ a: { url: "https://x" }, b: { url: "https://y" } }]);
		expect(result.error).toContain("exactly one server-name key");
	});

	it("rejects duplicate server names", () => {
		const result = parse([{ a: { url: "https://x" } }, { a: { url: "https://y" } }]);
		expect(result.error).toContain('duplicate server name "a"');
	});

	it("rejects names that collide after namespace sanitization", () => {
		const result = parse([
			{ "foo/bar": { url: "https://x" } },
			{ "foo bar": { url: "https://y" } },
		]);
		expect(result.error).toContain("collides");
		expect(result.error).toContain("mcp__foo_bar__");
	});

	it("rejects servers that declare neither url nor command", () => {
		expect(parse([{ a: { type: "http" } }]).error).toContain('requires a non-empty "url"');
		expect(parse([{ a: {} }]).error).toContain('must declare either "command"');
	});

	it("rejects servers that mix stdio and remote fields", () => {
		const result = parse([{ a: { command: "x", url: "https://y" } }]);
		expect(result.error).toContain("mixes stdio");
	});

	it("rejects unknown keys", () => {
		expect(parse([{ a: { url: "https://x", retries: 3 } }]).error).toContain("unknown key");
		expect(parse([{ a: { command: "x", shell: true } }]).error).toContain("unknown key");
	});

	it("rejects unsupported remote types", () => {
		expect(parse([{ a: { type: "grpc", url: "https://x" } }]).error).toContain("unsupported type");
	});

	it("rejects malformed args, headers, and urls", () => {
		expect(parse([{ a: { command: "x", args: "nope" } }]).error).toContain(
			"must be a list of strings",
		);
		expect(parse([{ a: { url: "https://x", headers: { A: 1 } } }]).error).toContain(
			"must be a string",
		);
		expect(parse([{ a: { url: "not a url" } }]).error).toContain("not a valid URL");
		expect(parse([{ a: { url: "ws://example.com/mcp" } }]).error).toContain(
			"must use http or https",
		);
	});

	it("includes the agent name and file path in errors", () => {
		const result = parse("not-a-list");
		expect(result.error).toContain(`agent "${AGENT}"`);
		expect(result.error).toContain(FILE);
	});
});

describe("mcp namespacing", () => {
	it("namespaces tools as mcp__<server>__<tool>", () => {
		expect(mcpToolName("atlassian", "createJiraIssue")).toBe("mcp__atlassian__createJiraIssue");
	});

	it("sanitizes server names with unsafe characters", () => {
		expect(sanitizeMcpName("my server!")).toBe("my_server");
		expect(sanitizeMcpName("@scope/name")).toBe("scope_name");
		expect(sanitizeMcpName("***")).toBe("server");
	});
});

describe("mcpContentToText", () => {
	it("joins text content parts", () => {
		const result = mcpContentToText({
			content: [
				{ type: "text", text: "line one" },
				{ type: "text", text: "line two" },
			],
		});
		expect(result).toEqual({ text: "line one\nline two", isError: false });
	});

	it("flags errors", () => {
		expect(mcpContentToText({ isError: true, content: [{ type: "text", text: "boom" }] })).toEqual({
			text: "boom",
			isError: true,
		});
	});

	it("falls back to toolResult json when content is absent", () => {
		const result = mcpContentToText({ toolResult: { ok: true } });
		expect(result.text).toContain('"ok": true');
	});

	it("surfaces structuredContent for output-schema tools", () => {
		const result = mcpContentToText({ content: [], structuredContent: { count: 2 } });
		expect(result.text).toBe('{\n  "count": 2\n}');
	});
});

describe("formatMcpSmokeReport", () => {
	const server: McpServerConfig = {
		name: "atlassian",
		transport: "http",
		url: "https://mcp.atlassian.com/v1/mcp",
	};

	it("reports no servers", () => {
		expect(formatMcpSmokeReport("plain", [])).toContain("no MCP servers");
	});

	it("renders a connected server with tool names", () => {
		const report = formatMcpSmokeReport("jira-mcp", [
			{ server, ok: true, toolNames: ["searchIssues", "createIssue"] },
		]);
		expect(report).toContain("status: connected");
		expect(report).toContain("tools (2): searchIssues, createIssue");
	});

	it("renders a failed server with its error", () => {
		const report = formatMcpSmokeReport("jira-mcp", [
			{ server, ok: false, error: "401 Unauthorized" },
		]);
		expect(report).toContain("status: error");
		expect(report).toContain("401 Unauthorized");
	});
});
