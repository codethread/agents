import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionLabel, isLongCacheRetentionEnabled, renderStatuslineItems } from "./index.js";

const ORIGINAL_CACHE_RETENTION = process.env.PI_CACHE_RETENTION;
const ORIGINAL_AGENT_ID = process.env.MILLSTRAND_AGENT_ID;

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
	beforeEach(() => {
		delete process.env.MILLSTRAND_AGENT_ID;
	});

	afterEach(() => {
		vi.useRealTimers();
		if (ORIGINAL_CACHE_RETENTION === undefined) {
			delete process.env.PI_CACHE_RETENTION;
		} else {
			process.env.PI_CACHE_RETENTION = ORIGINAL_CACHE_RETENTION;
		}
		if (ORIGINAL_AGENT_ID === undefined) {
			delete process.env.MILLSTRAND_AGENT_ID;
		} else {
			process.env.MILLSTRAND_AGENT_ID = ORIGINAL_AGENT_ID;
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
			getAvailableProviderCount: () => 2,
		};
		const ctx = {
			cwd: "/repo",
			model: {
				provider: "openai-codex",
				id: "gpt-test",
				reasoning: true,
				contextWindow: 10000,
			},
			modelRegistry: { isUsingOAuth: () => true },
			getContextUsage: () => ({ tokens: 2500, percent: 25, contextWindow: 10000 }),
			sessionManager: {
				getSessionName: () => "work",
				getSessionId: () => "abc",
				getBranch: () => [],
			},
		} as any;
		const pi = { getThinkingLevel: () => "high" } as any;
		const theme = { fg: vi.fn((_color: string, text: string) => text) };

		const previous = process.env.PI_CACHE_RETENTION;
		delete process.env.PI_CACHE_RETENTION;
		process.env.MILLSTRAND_AGENT_ID = "merry-swift-moose";
		try {
			const thinItems = renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 });
			expect(thinItems.slice(0, 3)).toEqual([
				"/repo (main)",
				"merry-swift-moose",
				"gpt-test • high (openai-codex sub)",
			]);
			expect(thinItems[3]).toContain("2.5k/10k $0.000");
			expect(thinItems[3]).toContain("work (abc)");
			expect(thinItems[3]).toHaveLength(80);
			expect(thinItems[4]).toBe("busy now");
			expect(theme.fg).toHaveBeenCalledWith("accent", "merry-swift-moose");

			const nativeIdentityItems = renderStatuslineItems({
				ctx,
				pi,
				footerData,
				theme,
				width: 80,
				millstrandIdentity: "crisp-kind-ibis",
			});
			expect(nativeIdentityItems[1]).toBe("crisp-kind-ibis");

			const wideItems = renderStatuslineItems({ ctx, pi, footerData, theme, width: 120 });
			expect(wideItems).toHaveLength(3);
			expect(wideItems[0]).toContain("/repo (main)");
			expect(wideItems[0]).toContain("merry-swift-moose");
			expect(wideItems[0]).toContain("gpt-test • high (openai-codex sub)");
			expect(wideItems[0]).toHaveLength(120);
			expect(wideItems[1]).toContain("2.5k/10k $0.000");
			expect(wideItems[1]).toContain("work (abc)");
			expect(wideItems[1]).toHaveLength(120);

			process.env.PI_CACHE_RETENTION = "long";
			expect(renderStatuslineItems({ ctx, pi, footerData, theme, width: 80 })[2]).toBe(
				"gpt-test • high (openai-codex sub L)",
			);
		} finally {
			if (previous === undefined) {
				delete process.env.PI_CACHE_RETENTION;
			} else {
				process.env.PI_CACHE_RETENTION = previous;
			}
		}
	});

	it("shows only the latest cache-hit timestamp", () => {
		process.env.PI_CACHE_RETENTION = "short";
		const missTimestamp = "2026-06-25T12:35:00Z";
		const hitTimestamp = "2026-06-25T12:34:00Z";
		const latestHitTimestamp = "2026-06-25T12:35:20Z";
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
			`2.5k/10k [${expectedLatestHitTime}] $0.060`,
		);
	});

	it("keeps the latest cache-hit timestamp after a miss", () => {
		process.env.PI_CACHE_RETENTION = "short";
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
			`2.5k/10k [${expectedHitTime}] $0.030`,
		);
	});
});
