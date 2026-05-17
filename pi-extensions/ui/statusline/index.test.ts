import { describe, expect, it } from "vitest";
import { formatSessionLabel, renderStatuslineItems } from "./index.js";

describe("formatSessionLabel", () => {
	it("shows the session id next to the name", () => {
		expect(formatSessionLabel("review-flow", "session-123")).toBe("review-flow (session-123)");
	});

	it("falls back to the session id when no name exists", () => {
		expect(formatSessionLabel(undefined, "session-123")).toBe("session session-123");
	});

	it("sanitizes control characters before rendering", () => {
		expect(formatSessionLabel("review\nflow", "session\t123")).toBe("review flow (session 123)");
	});

	it("returns null when both fields are missing", () => {
		expect(formatSessionLabel(undefined, undefined)).toBeNull();
	});
});

describe("renderStatuslineItems", () => {
	it("returns atomic status items for flex layout consumers", () => {
		const footerData = {
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map([["worker", "busy\nnow"]]),
			getAvailableProviderCount: () => 1,
		};
		const ctx = {
			cwd: "/repo",
			model: { id: "gpt-test", reasoning: true, contextWindow: 10000 },
			modelRegistry: { isUsingOAuth: () => false },
			getContextUsage: () => ({ tokens: 2500, percent: 25, contextWindow: 10000 }),
			sessionManager: {
				getSessionName: () => "work",
				getSessionId: () => "abc",
				getBranch: () => [],
			},
		} as any;
		const pi = { getThinkingLevel: () => "high" } as any;
		const theme = { fg: (_color: string, text: string) => text };

		expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })).toEqual([
			"/repo (main) • work (abc)",
			"ctx 2.5k 25.0%/10k",
			"$0.000",
			"gpt-test • high",
			"busy now",
		]);
	});
});
