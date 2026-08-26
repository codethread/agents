import { describe, expect, it } from "vitest";
import { describeMcpServer, parseMcpServers } from "./mcp.js";

const parse = (value: unknown) => parseMcpServers(value, "nerd", "/tmp/nerd.md");

describe("parseMcpServers", () => {
	it("parses adapter-compatible stdio and remote definitions", () => {
		expect(
			parse([
				{ context7: { command: "bunx", args: ["-y", "@upstash/context7-mcp"] } },
				{ docs: { type: "sse", url: "https://example.com/mcp", headers: { X: "y" } } },
			]).servers,
		).toEqual([
			{ name: "context7", command: "bunx", args: ["-y", "@upstash/context7-mcp"] },
			{
				name: "docs",
				url: "https://example.com/mcp",
				headers: { X: "y" },
				httpTransport: "sse",
			},
		]);
	});

	it("returns no definitions when frontmatter is absent", () => {
		expect(parse(undefined)).toEqual({ servers: [] });
	});

	it.each([
		[[{ server: { command: "x", url: "https://example.com" } }], "mixes stdio"],
		[[{ server: { url: "not a url" } }], "not a valid URL"],
		[[{ server: { command: "x", args: "bad" } }], "list of strings"],
		[[{ server: { command: "x", unknown: true } }], "unknown key"],
		[[{ server: { type: "grpc", url: "https://example.com" } }], "unsupported type"],
	])("rejects malformed frontmatter", (value, message) => {
		const result = parse(value);
		expect(result.servers).toEqual([]);
		expect(result.error).toContain(message);
		expect(result.error).toContain('agent "nerd" at /tmp/nerd.md');
	});

	it("rejects duplicate server names", () => {
		expect(parse([{ a: { command: "x" } }, { a: { command: "y" } }]).error).toContain(
			'duplicate server name "a"',
		);
	});
});

describe("describeMcpServer", () => {
	it("formats definitions without connecting", () => {
		expect(describeMcpServer({ name: "docs", url: "https://example.com" })).toBe(
			"http: https://example.com",
		);
	});
});
