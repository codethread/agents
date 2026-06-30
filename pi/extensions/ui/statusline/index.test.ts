import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSessionLabel, isLongCacheRetentionEnabled, renderStatuslineItems } from "./index.js";

const ORIGINAL_CACHE_RETENTION = process.env.PI_CACHE_RETENTION;

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
	afterEach(() => {
		vi.useRealTimers();
		if (ORIGINAL_CACHE_RETENTION === undefined) {
			delete process.env.PI_CACHE_RETENTION;
		} else {
			process.env.PI_CACHE_RETENTION = ORIGINAL_CACHE_RETENTION;
		}
	});

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

	it("shows a recent cache miss after a prior cache hit", () => {
		vi.useFakeTimers();
		process.env.PI_CACHE_RETENTION = "short";
		vi.setSystemTime(new Date("2026-06-25T12:35:30Z"));
		const missTimestamp = "2026-06-25T12:35:00Z";
		const hitTimestamp = "2026-06-25T12:34:00Z";
		const latestHitTimestamp = "2026-06-25T12:35:20Z";
		const expectedHitTime = new Date(hitTimestamp).toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		const expectedMissTime = new Date(missTimestamp).toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		const expectedLatestHitTime = new Date(latestHitTimestamp).toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		const footerData = {
			getGitBranch: () => null,
			getExtensionStatuses: () => new Map(),
			getAvailableProviderCount: () => 1,
		};
		const ctx = {
			cwd: "/repo",
			model: { id: "gpt-test", reasoning: false, contextWindow: 10000 },
			modelRegistry: { isUsingOAuth: () => true },
			getContextUsage: () => ({ tokens: 2500, percent: 25, contextWindow: 10000 }),
			sessionManager: {
				getSessionName: () => undefined,
				getSessionId: () => undefined,
				getBranch: () => [
					{
						type: "message",
						timestamp: hitTimestamp,
						message: {
							role: "assistant",
							usage: {
								input: 100,
								cacheRead: 1000,
								cost: { input: 0.001, cacheRead: 0.001, total: 0.01 },
							},
						},
					},
					{
						type: "message",
						timestamp: missTimestamp,
						message: {
							role: "assistant",
							usage: {
								input: 1100,
								cacheRead: 0,
								cost: { input: 0.011, cacheRead: 0, total: 0.02 },
							},
						},
					},
					{
						type: "message",
						timestamp: latestHitTimestamp,
						message: { role: "assistant", usage: { cacheRead: 1000, cost: { total: 0.03 } } },
					},
				],
			},
		} as any;
		const pi = { getThinkingLevel: () => "off" } as any;
		const theme = { fg: (_color: string, text: string) => text };

		expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })[2]).toBe(
			`$0.060 [${expectedLatestHitTime} !miss ${expectedHitTime} -> ${expectedMissTime} ~1.0k tok ~$0.009] (sub)`,
		);
	});

	it("stops showing a cache miss after one minute on the next render", () => {
		vi.useFakeTimers();
		process.env.PI_CACHE_RETENTION = "short";
		vi.setSystemTime(new Date("2026-06-25T12:36:01Z"));
		const hitTimestamp = "2026-06-25T12:34:00Z";
		const expectedHitTime = new Date(hitTimestamp).toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		const footerData = {
			getGitBranch: () => null,
			getExtensionStatuses: () => new Map(),
			getAvailableProviderCount: () => 1,
		};
		const ctx = {
			cwd: "/repo",
			model: { id: "gpt-test", reasoning: false, contextWindow: 10000 },
			modelRegistry: { isUsingOAuth: () => false },
			getContextUsage: () => ({ tokens: 2500, percent: 25, contextWindow: 10000 }),
			sessionManager: {
				getSessionName: () => undefined,
				getSessionId: () => undefined,
				getBranch: () => [
					{
						type: "message",
						timestamp: hitTimestamp,
						message: { role: "assistant", usage: { cacheRead: 1000, cost: { total: 0.01 } } },
					},
					{
						type: "message",
						timestamp: "2026-06-25T12:35:00Z",
						message: { role: "assistant", usage: { cacheRead: 0, cost: { total: 0.02 } } },
					},
				],
			},
		} as any;
		const pi = { getThinkingLevel: () => "off" } as any;
		const theme = { fg: (_color: string, text: string) => text };

		expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })[2]).toBe(
			`$0.030 [${expectedHitTime}]`,
		);
	});
});
