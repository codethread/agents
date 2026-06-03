import { describe, expect, it } from "vitest";
import {
	getPolicyProvider,
	matchesPathRule,
	parseProviderOverrideConfig,
} from "./config.js";

const env = { HOME: "/Users/alice" } as NodeJS.ProcessEnv;

describe("provider override config", () => {
	it("parses and normalizes ordered path rules", () => {
		const config = parseProviderOverrideConfig(
			{
				providers: ["openai", "openai-codex"],
				default: "openai-codex",
				paths: [
					{ path: "~/dev/sponsored/", provider: "openai" },
					{ path: "~/dev", provider: "openai-codex" },
				],
			},
			env,
		);

		expect(config.paths).toEqual([
			{ path: "/Users/alice/dev/sponsored", provider: "openai" },
			{ path: "/Users/alice/dev", provider: "openai-codex" },
		]);
		expect(getPolicyProvider(config, "/Users/alice/dev/sponsored/repo")).toBe("openai");
		expect(getPolicyProvider(config, "/Users/alice/dev/other")).toBe("openai-codex");
		expect(getPolicyProvider(config, "/Users/alice/tmp")).toBe("openai-codex");
	});

	it("matches exact paths and children without substring matches", () => {
		expect(matchesPathRule("/Users/alice/dev", "/Users/alice/dev")).toBe(true);
		expect(matchesPathRule("/Users/alice/dev/project", "/Users/alice/dev")).toBe(true);
		expect(matchesPathRule("/Users/alice/development/project", "/Users/alice/dev")).toBe(false);
	});

	it("rejects relative paths", () => {
		expect(() =>
			parseProviderOverrideConfig(
				{
					providers: ["openai", "openai-codex"],
					default: "openai-codex",
					paths: [{ path: "dev", provider: "openai" }],
				},
				env,
			),
		).toThrow(/must be absolute/);
	});

	it("rejects providers outside the managed set", () => {
		expect(() =>
			parseProviderOverrideConfig(
				{
					providers: ["openai", "openai-codex"],
					default: "openai-codex",
					paths: [{ path: "~/work", provider: "anthropic" }],
				},
				env,
			),
		).toThrow(/not listed in providers/);
	});

	it("rejects duplicate providers", () => {
		expect(() =>
			parseProviderOverrideConfig(
				{
					providers: ["openai", "openai"],
					default: "openai",
					paths: [],
				},
				env,
			),
		).toThrow(/duplicate provider/);
	});
});
