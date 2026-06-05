import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { formatBashCommandForDisplay, formatBashCommandPreview } from "./bash.js";

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

describe("formatBashCommandPreview", () => {
	it("caps chained command previews at five lines", () => {
		expect(
			formatBashCommandPreview(
				"echo doing thing && echo doing thing 2 && echo doing thing 3 && echo doing thing 4 && echo doing thing 5 && echo doing thing 6",
				120,
			),
		).toEqual([
			"$ echo doing thing",
			"  && echo doing thing 2",
			"  && echo doing thing 3",
			"  && echo doing thing 4",
			"  && echo doing thing 5 ...",
		]);
	});

	it("counts word-wrapped visual lines against the five-line cap", () => {
		expect(
			formatBashCommandPreview(
				'echo doing thing that spans over 40 chars is split on words && echo "this is now line 4 of the max output and hide any more lines" && echo hidden && echo hidden 2',
				40,
			),
		).toEqual([
			"$ echo doing thing that spans over 40",
			"  \\ chars is split on words",
			'  && echo "this is now line 4 of the',
			'  \\ max output and hide any more lines"',
			"  && echo hidden ...",
		]);
	});

	it("uses visible width when wrapping wide glyphs", () => {
		const lines = formatBashCommandPreview(`printf '${"😺".repeat(100)}'`, 20);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
	});
});
