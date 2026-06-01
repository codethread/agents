import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	discoverProjectRules,
	getPathScopedRules,
	getUnconditionalRules,
	matchesRule,
	normalizeProjectPath,
} from "./project-rules.js";

function makeRoot() {
	return path.join(os.tmpdir(), `project-rules-${randomUUID()}`);
}

function write(root: string, filePath: string, content: string) {
	const fullPath = path.join(root, filePath);
	mkdirSync(path.dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

function execFor(root: string) {
	return async () => ({ code: 0, stdout: `${root}\n` });
}

describe("project rules", () => {
	it("discovers project-local claude and agents rules and applies exact relative-path override", async () => {
		const root = makeRoot();
		write(root, ".claude/rules/testing.md", "claude testing");
		write(root, ".agents/rules/testing.md", "agents testing");
		write(root, ".claude/rules/frontend/react.md", "claude react");
		write(root, ".agents/rules/react.md", "agents react");

		const discovery = await discoverProjectRules(root, execFor(root));

		expect(discovery.warnings).toEqual([]);
		expect(
			discovery.rules.map((rule) => [rule.source, rule.relativeRulePath, rule.body.trim()]),
		).toEqual([
			["claude", "frontend/react.md", "claude react"],
			["agents", "react.md", "agents react"],
			["agents", "testing.md", "agents testing"],
		]);
	});

	it("parses path-scoped rules and matches project-relative globs with braces", async () => {
		const root = makeRoot();
		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.{ts,tsx}"
---

# TS
`,
		);
		write(root, ".agents/rules/always.md", "# Always");

		const discovery = await discoverProjectRules(root, execFor(root));
		const scoped = getPathScopedRules(discovery.rules);

		expect(getUnconditionalRules(discovery.rules).map((rule) => rule.relativeRulePath)).toEqual([
			"always.md",
		]);
		expect(scoped).toHaveLength(1);
		expect(matchesRule(scoped[0], "src/app.ts")).toBe(true);
		expect(matchesRule(scoped[0], "src/components/App.tsx")).toBe(true);
		expect(matchesRule(scoped[0], "README.md")).toBe(false);
	});

	it("normalizes only paths inside the project root", () => {
		const root = makeRoot();
		expect(normalizeProjectPath("src/index.ts", root, root)).toBe("src/index.ts");
		expect(normalizeProjectPath(path.join(root, "src/index.ts"), root, root)).toBe("src/index.ts");
		expect(normalizeProjectPath(path.dirname(root), root, root)).toBeNull();
	});

	it("warns and skips malformed frontmatter without blocking discovery", async () => {
		const root = makeRoot();
		write(root, ".agents/rules/bad.md", "---\npaths: nope\n---\n# Bad");
		write(root, ".agents/rules/good.md", "# Good");

		const discovery = await discoverProjectRules(root, execFor(root));

		expect(discovery.rules.map((rule) => rule.relativeRulePath)).toEqual(["good.md"]);
		expect(discovery.warnings).toHaveLength(1);
		expect(discovery.warnings[0]).toContain("bad.md");
	});
});
