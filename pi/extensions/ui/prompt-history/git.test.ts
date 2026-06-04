import { describe, expect, it } from "vitest";
import { parseCanonicalRepoRoot } from "./git.js";

describe("parseCanonicalRepoRoot", () => {
	it("maps a standard .git common dir back to the repository root", () => {
		expect(parseCanonicalRepoRoot("/work/repo/.git\n")).toBe("/work/repo");
	});

	it("preserves non-.git shared git directories", () => {
		expect(parseCanonicalRepoRoot("/work/shared/git-dir\n")).toBe("/work/shared/git-dir");
	});

	it("returns undefined for blank output", () => {
		expect(parseCanonicalRepoRoot("  \n")).toBeUndefined();
	});
});
