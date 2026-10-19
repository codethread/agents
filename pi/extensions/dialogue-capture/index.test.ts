import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DialogueRecord } from "./capture.js";
import dialogueCaptureExtension from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const stateDir = mkdtempSync(join(tmpdir(), "pi-dialogue-capture-"));
	tempDirs.push(stateDir);
	vi.stubEnv("XDG_STATE_HOME", stateDir);
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	dialogueCaptureExtension({
		on: (name: string, handler: (event: any, ctx: any) => unknown) => handlers.set(name, handler),
		registerFlag: vi.fn(),
		registerCommand: vi.fn(),
		getFlag: () => false,
		getThinkingLevel: () => "low",
	} as any);
	const ctx = { cwd: "/repo", sessionManager: { getSessionId: () => "session-1" } };
	const emit = (name: string, event: unknown = {}) => handlers.get(name)!(event, ctx);
	const records = (): DialogueRecord[] =>
		readFileSync(join(stateDir, "pi-dialogue/session-1.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as DialogueRecord);
	return { emit, records };
}

describe("dialogue-capture extension", () => {
	it("captures only user prompts and leaves custom-run replies and files uncorrelated", () => {
		const { emit, records } = setup();
		emit("session_start");
		emit("before_agent_start", { messageType: "user", prompt: "First prompt" });
		emit("agent_end", { messages: [{ role: "assistant", content: "First reply" }] });
		emit("before_agent_start", {
			messageType: "custom",
			message: { customType: "continue", content: "Continue work", display: false },
		});
		emit("tool_result", { toolName: "read", input: { path: "/repo/a.ts" }, isError: false });
		emit("agent_end", { messages: [{ role: "assistant", content: "Custom reply" }] });
		emit("before_agent_start", { messageType: "user", prompt: "Next prompt" });
		emit("agent_end", { messages: [{ role: "assistant", content: "Next reply" }] });

		const captured = records();
		expect(captured.map(({ event }) => event)).toEqual([
			"prompt",
			"reply",
			"file",
			"reply",
			"prompt",
			"reply",
		]);
		expect(captured[0]).toMatchObject({ text: "First prompt", prompt_id: expect.any(String) });
		expect(captured[1]).toMatchObject({ text: "First reply", prompt_id: captured[0].prompt_id });
		expect(captured[2]).toMatchObject({ file_path: "/repo/a.ts", prompt_id: null });
		expect(captured[3]).toMatchObject({ text: "Custom reply", prompt_id: null });
		expect(captured[4]).toMatchObject({ text: "Next prompt", prompt_id: expect.any(String) });
		expect(captured[4].prompt_id).not.toBe(captured[0].prompt_id);
		expect(captured[5]).toMatchObject({ text: "Next reply", prompt_id: captured[4].prompt_id });
	});
});
