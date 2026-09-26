import { describe, expect, it } from "vitest";
import {
	extensionExclusionsFromSettings,
	filterDaemonIncompatibleExtensions,
	parseExtensionExclusions,
} from "./extensions.ts";

describe("filterDaemonIncompatibleExtensions", () => {
	it("keeps headless extensions and removes interactive helpers", () => {
		const subagent = {
			path: "/repo/pi/extensions/tools/subagent/index.ts",
			tools: new Map([["subagent", {}]]),
		};
		const piNvim = {
			path: "/home/user/.pi/agent/packages/pi-nvim/extension.ts",
			tools: new Map(),
		};
		const other = {
			path: "/repo/pi/extensions/tools/web-access/index.ts",
			tools: new Map([["web_search", {}]]),
		};
		const base = { extensions: [subagent, piNvim, other], errors: [] };

		expect(filterDaemonIncompatibleExtensions(base)).toEqual({
			extensions: [subagent, other],
			errors: [],
		});
	});

	it("adds path-substring exclusions supplied by configuration", () => {
		const base = {
			extensions: [
				{ path: "/repo/pi/extensions/tools/subagent/index.ts" },
				{ path: "/repo/pi/extensions/ui/tldr/index.ts" },
			],
			errors: [],
		};

		expect(filterDaemonIncompatibleExtensions(base, ["\\ui\\tldr\\"])).toEqual({
			extensions: [base.extensions[0]],
			errors: [],
		});
	});
});

describe("extension exclusion configuration", () => {
	it("reads the namespaced key from Pi settings", () => {
		expect(
			extensionExclusionsFromSettings(
				{ pies: { excludeExtensions: [" pi-nvim ", "\\ui\\"] } },
				"project",
			),
		).toEqual(["pi-nvim", "/ui/"]);
	});

	it("rejects invalid Pi settings with the relevant scope", () => {
		expect(() =>
			extensionExclusionsFromSettings({ pies: { excludeExtensions: ["valid", ""] } }, "global"),
		).toThrow(
			'Invalid global Pi settings: "pies.excludeExtensions" must be an array of non-empty strings',
		);
	});

	it("parses comma-separated request environment exclusions", () => {
		expect(parseExtensionExclusions(" pi-nvim,\\ui\\tldr\\, ")).toEqual(["pi-nvim", "/ui/tldr/"]);
	});
});
