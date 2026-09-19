import { describe, expect, it } from "vitest";
import { parsePromptHistoryPickerSelection } from "./fzf.js";

describe("parsePromptHistoryPickerSelection", () => {
	it("round-trips a selected history line back into exact prompt text", () => {
		const message = 'multi\nline\tprompt with "quotes" and 日本語';
		const record = {
			version: 1,
			timestamp: 1791139200000,
			message,
			cwd: "/repo/app",
			repoRoot: "/repo",
		};

		expect(
			parsePromptHistoryPickerSelection(
				`2026-09-19 05:36  app  multi line prompt\t${JSON.stringify(record)}\n`,
			),
		).toBe(message);
	});

	it("returns undefined for an empty selection", () => {
		expect(parsePromptHistoryPickerSelection("")).toBeUndefined();
	});

	it("rejects a selection line without a record payload", () => {
		expect(() => parsePromptHistoryPickerSelection("2026-09-19 05:36  app  prompt\n")).toThrow(
			"Fuzzy prompt history selection is missing its record payload.",
		);
	});

	it("rejects a payload without a string message", () => {
		expect(() =>
			parsePromptHistoryPickerSelection('2026-09-19 05:36  app  prompt\t{"message":7}\n'),
		).toThrow("Fuzzy prompt history selection is missing a string message.");
	});
});
