import { describe, expect, it } from "vitest";

import { formatBashCommandForDisplay } from "./bash.js";

describe("formatBashCommandForDisplay", () => {
	it("line breaks chained commands on && and ||", () => {
		expect(formatBashCommandForDisplay("pnpm lint && pnpm typecheck || pnpm test")).toBe(
			"pnpm lint\n  && pnpm typecheck\n  || pnpm test",
		);
	});

	it("does not split operators inside quotes", () => {
		expect(formatBashCommandForDisplay("git commit -m 'fix && test' && git status")).toBe(
			"git commit -m 'fix && test'\n  && git status",
		);
	});
});
