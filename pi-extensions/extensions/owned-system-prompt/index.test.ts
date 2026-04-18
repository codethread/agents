import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import ownedSystemPromptExtension, {
	buildOwnedGuidelines,
	buildOwnedPromptAddon,
	getOwnedBuiltinTools,
	shouldAppendOwnedPrompt,
} from "./index.js";

interface TestContext {
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
	};
	getSystemPrompt: () => string;
}

type EventHandler = (event: any, ctx: TestContext) => unknown | Promise<unknown>;

const stdoutWrite = vi.spyOn(process.stdout, "write");
const processExit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);

afterEach(() => {
	stdoutWrite.mockClear();
	processExit.mockClear();
});

afterAll(() => {
	stdoutWrite.mockRestore();
	processExit.mockRestore();
});

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
	const notify = vi.fn();
	return {
		hasUI: true,
		ui: { notify },
		getSystemPrompt: () => "Owned prompt",
		...overrides,
	};
}

function setupExtension(options?: { activeTools?: string[]; debugOwnedPrompt?: boolean }) {
	const handlers = new Map<string, EventHandler>();
	const registerFlag = vi.fn();
	const sendUserMessage = vi.fn();
	const getActiveTools = vi.fn(() => options?.activeTools ?? ["read", "bash", "edit", "write"]);
	const getFlag = vi.fn((name: string) => {
		if (name === "debug-owned-prompt") return options?.debugOwnedPrompt ?? false;
		return undefined;
	});

	ownedSystemPromptExtension({
		on(eventName: string, handler: EventHandler) {
			handlers.set(eventName, handler);
		},
		registerFlag,
		sendUserMessage,
		getActiveTools,
		getFlag,
	} as any);

	return {
		beforeAgentStartHandler: handlers.get("before_agent_start"),
		agentStartHandler: handlers.get("agent_start"),
		sessionStartHandler: handlers.get("session_start"),
		getActiveTools,
		getFlag,
		registerFlag,
		sendUserMessage,
	};
}

describe("owned-system-prompt helpers", () => {
	it("keeps builtin tool output in deterministic order", () => {
		expect(getOwnedBuiltinTools(["write", "custom", "read", "ls"])).toEqual([
			"read",
			"write",
			"ls",
		]);
	});

	it("builds owned guidelines for the default built-in tool set", () => {
		expect(buildOwnedGuidelines(["read", "bash", "edit", "write"])).toEqual([
			"Use bash for file operations like ls, rg, find",
			"Use read to examine files instead of cat or sed.",
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
			"Use write only for new files or complete rewrites.",
			"Be concise in your responses",
			"Show file paths clearly when working with files",
		]);
	});

	it("prefers dedicated exploration tools when grep/find/ls are active", () => {
		expect(buildOwnedGuidelines(["bash", "grep", "find", "ls"])).toContain(
			"Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
		);
		expect(buildOwnedGuidelines(["bash", "grep", "find", "ls"])).not.toContain(
			"Use bash for file operations like ls, rg, find",
		);
	});

	it("renders the owned prompt addon from synced builtin metadata", () => {
		expect(buildOwnedPromptAddon(["read", "bash", "edit", "write"])).toContain(
			"Available tools:\n- read: Read file contents\n- bash: Execute bash commands (ls, grep, find, etc.)\n- edit: Make precise file edits with exact text replacement, including multiple disjoint edits in one call\n- write: Create or overwrite files",
		);
		expect(buildOwnedPromptAddon(["read", "bash", "edit", "write"])).toContain(
			"Guidelines:\n- Use bash for file operations like ls, rg, find",
		);
	});

	it("skips prompt ownership when pi's default base prompt is still present", () => {
		expect(
			shouldAppendOwnedPrompt(
				"You are an expert coding assistant operating inside pi, a coding agent harness.\n\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):",
			),
		).toBe(false);
		expect(
			shouldAppendOwnedPrompt(
				"You are an expert coding assistant operating inside pi, a coding agent harness.",
			),
		).toBe(true);
	});
});

describe("owned-system-prompt extension", () => {
	it("registers the debug-owned-prompt flag", () => {
		const { registerFlag } = setupExtension();

		expect(registerFlag).toHaveBeenCalledWith(
			"debug-owned-prompt",
			expect.objectContaining({
				type: "boolean",
				default: false,
			}),
		);
	});

	it("appends the owned prompt addon when using a custom SYSTEM.md base prompt", async () => {
		const { beforeAgentStartHandler } = setupExtension({
			activeTools: ["read", "bash", "edit", "write", "subagent"],
		});

		const result = await beforeAgentStartHandler?.(
			{
				systemPrompt:
					"You are an expert coding assistant operating inside pi, a coding agent harness.",
			},
			makeContext(),
		);

		expect(result).toEqual({
			systemPrompt: expect.stringContaining(
				"You are an expert coding assistant operating inside pi, a coding agent harness.\n\nYou help users by reading files, executing commands, editing code, and writing new files.",
			),
		});
		expect(result).toEqual({
			systemPrompt: expect.stringContaining(
				"In addition to the tools above, you may have access to other custom tools depending on the project.",
			),
		});
	});

	it("does not append duplicate sections when pi's default prompt is still active", async () => {
		const { beforeAgentStartHandler } = setupExtension();

		const result = await beforeAgentStartHandler?.(
			{
				systemPrompt:
					"You are an expert coding assistant operating inside pi, a coding agent harness.\n\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):\n- Main documentation: /docs",
			},
			makeContext(),
		);

		expect(result).toBeUndefined();
	});

	it("queues a ping turn when debug-owned-prompt is enabled", async () => {
		const { sessionStartHandler, sendUserMessage } = setupExtension({ debugOwnedPrompt: true });
		const ctx = makeContext();

		await sessionStartHandler?.({}, ctx);

		expect(sendUserMessage).toHaveBeenCalledWith("ping");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Debug owned prompt mode: starting a ping turn to materialize the prompt.",
			"info",
		);
	});

	it("prints the effective prompt and exits during debug-owned-prompt mode", async () => {
		stdoutWrite.mockReturnValue(true);
		const { sessionStartHandler, agentStartHandler } = setupExtension({ debugOwnedPrompt: true });
		const ctx = makeContext({ getSystemPrompt: () => "\nOwned prompt\n" });

		await sessionStartHandler?.({}, ctx);
		await agentStartHandler?.({}, ctx);

		expect(stdoutWrite).toHaveBeenCalledWith("Owned prompt\n");
		expect(processExit).toHaveBeenCalledWith(0);
	});
});
