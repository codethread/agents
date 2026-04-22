import { afterEach, describe, expect, it, vi } from "vitest";
import type * as PiAi from "@mariozechner/pi-ai";

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof PiAi>();
	return {
		...actual,
		complete: vi.fn(),
	};
});

import { complete } from "@mariozechner/pi-ai";
import {
	calls,
	createTestSession,
	says,
	type TestSession,
	when,
} from "@marcfargas/pi-test-harness";
import tldrExtension from "./index.js";
const TLDR_MODEL = {
	provider: "openai",
	id: "gpt-5.4-nano",
	reasoning: true,
} as const;

let t: TestSession | undefined;

afterEach(() => {
	t?.dispose();
	t = undefined;
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

async function createTldrSession(options?: {
	availableModels?: Array<{ provider: string; id: string; reasoning?: boolean }>;
	authResult?: { ok: boolean; apiKey?: string; headers?: Record<string, string>; error?: string };
	mockTools?: Record<string, string | ((params: Record<string, unknown>) => string)>;
}): Promise<TestSession> {
	t = await createTestSession({
		extensionFactories: [tldrExtension],
		mockTools: options?.mockTools,
	});

	const agent = (t.session as any).agent;
	if (typeof agent.setTools !== "function") {
		agent.setTools = (tools: unknown[]) => {
			agent.state.tools = tools;
		};
	}

	const modelRegistry = (t.session as any).modelRegistry;
	modelRegistry.hasConfiguredAuth = vi.fn(() => true);
	modelRegistry.getAvailable = vi.fn(() => options?.availableModels ?? [TLDR_MODEL]);
	modelRegistry.getApiKeyAndHeaders = vi
		.fn()
		.mockResolvedValue(options?.authResult ?? { ok: true, apiKey: "test-key" });

	return t;
}

function getNotifyMessages(session: TestSession): string[] {
	return session.events.uiCallsFor("notify").map((call) => String(call.args[0]));
}

describe("tldr extension harness integration", () => {
	it("summarizes the current session via /tldr without adding the summary back into agent context", async () => {
		const completeSpy = vi.mocked(complete).mockResolvedValue({
			role: "assistant",
			content: [
				{
					type: "text",
					text: [
						"## Goal",
						"Catch up on the session.",
						"## Status",
						"Mapped the repo and identified the next testing task.",
						"## Important context",
						"Tool chatter should stay out of the summary transcript.",
						"## Next",
						"Add the first integration tests.",
					].join("\n"),
				},
			],
			stopReason: "stop",
		} as any);
		const session = await createTldrSession({
			mockTools: {
				bash: "README.md\nsrc\n",
			},
		});

		await session.run(
			when("Inspect the repo", [
				calls("bash", { command: "ls" }),
				says("I found README.md and src."),
			]),
			when("What should we do next?", [says("We should add integration coverage for TL;DR.")]),
		);

		const messageCountBefore = session.events.messages.length;
		const branchLengthBefore = (session.session as any).sessionManager.getBranch().length;

		await (session.session as any).prompt("/tldr");

		expect(completeSpy).toHaveBeenCalledTimes(1);
		const [model, request, options] = completeSpy.mock.calls[0] as unknown as [
			{ provider: string; id: string },
			{ messages: Array<{ content: Array<{ text?: string }> }> },
			{ apiKey?: string; reasoningEffort?: string },
		];
		expect(model).toMatchObject({ provider: "openai", id: "gpt-5.4-nano" });
		expect(options).toMatchObject({ apiKey: "test-key", reasoningEffort: "low" });

		const promptText = request.messages[0]?.content[0]?.text ?? "";
		expect(promptText).toContain("# User\n\nInspect the repo");
		expect(promptText).toContain("# Assistant\n\nI found README.md and src.");
		expect(promptText).toContain("# User\n\nWhat should we do next?");
		expect(promptText).toContain("# Assistant\n\nWe should add integration coverage for TL;DR.");
		expect(promptText).not.toContain("README.md\nsrc");
		expect(promptText).not.toContain('"command":"ls"');

		expect(getNotifyMessages(session)).toEqual([
			"Generating TL;DR...",
			"TL;DR: extracted session transcript",
			"TL;DR: using openai/gpt-5.4-nano:low",
			"TL;DR ready",
		]);
		expect(session.events.messages).toHaveLength(messageCountBefore);
		expect((session.session as any).sessionManager.getBranch()).toHaveLength(branchLengthBefore);
	});

	it("warns and skips when no preferred summary model is available", async () => {
		const completeSpy = vi.mocked(complete).mockResolvedValue({
			role: "assistant",
			content: [{ type: "text", text: "unused" }],
			stopReason: "stop",
		} as any);
		const session = await createTldrSession({ availableModels: [] });

		await session.run(when("Hello", [says("Hi there.")]));

		const messageCountBefore = session.events.messages.length;
		const branchLengthBefore = (session.session as any).sessionManager.getBranch().length;

		await (session.session as any).prompt("/tldr");

		expect(completeSpy).not.toHaveBeenCalled();
		expect(getNotifyMessages(session)).toEqual([
			"Generating TL;DR...",
			"TL;DR: extracted session transcript",
			"TL;DR: no configured summary model available; skipping",
		]);
		expect(session.events.messages).toHaveLength(messageCountBefore);
		expect((session.session as any).sessionManager.getBranch()).toHaveLength(branchLengthBefore);
	});
});
