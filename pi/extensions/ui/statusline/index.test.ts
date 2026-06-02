import { describe, expect, it } from "vitest";
import { formatSessionLabel, isLongCacheRetentionEnabled, renderStatuslineItems } from "./index.js";

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
	it("detects long cache retention from the environment", () => {
		expect(isLongCacheRetentionEnabled({ PI_CACHE_RETENTION: "long" })).toBe(true);
		expect(isLongCacheRetentionEnabled({ PI_CACHE_RETENTION: "short" })).toBe(false);
		expect(isLongCacheRetentionEnabled({})).toBe(false);
	});

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

		const previous = process.env.PI_CACHE_RETENTION;
		delete process.env.PI_CACHE_RETENTION;
		try {
			expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })).toEqual([
				"/repo (main) • work (abc)",
				"ctx 2.5k 25.0%/10k",
				"$0.000",
				"gpt-test • high",
				"busy now",
			]);

			process.env.PI_CACHE_RETENTION = "long";
			expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })[2]).toBe(
				"$0.000 • cache long",
			);
		} finally {
			if (previous === undefined) {
				delete process.env.PI_CACHE_RETENTION;
			} else {
				process.env.PI_CACHE_RETENTION = previous;
			}
		}
	});
});
