import { describe, expect, it } from "vitest";
import {
	agentTypeFromArgv,
	buildRecord,
	dialogueStateDir,
	formatReport,
	lastAssistantText,
	messageText,
	modelSlug,
	normalizeThinkingLevel,
	SCHEMA_VERSION,
} from "./capture.js";

describe("dialogueStateDir", () => {
	it("uses XDG_STATE_HOME when set", () => {
		expect(dialogueStateDir({ XDG_STATE_HOME: "/tmp/state" })).toBe("/tmp/state/pi-dialogue");
	});

	it("falls back to ~/.local/state when unset or blank", () => {
		expect(dialogueStateDir({})).toMatch(/\.local\/state\/pi-dialogue$/);
		expect(dialogueStateDir({ XDG_STATE_HOME: "  " })).toMatch(/\.local\/state\/pi-dialogue$/);
	});
});

describe("agentTypeFromArgv", () => {
	it("reads --agent with a separate value", () => {
		expect(agentTypeFromArgv(["pi", "--agent", "main", "-p"])).toBe("main");
	});

	it("reads --agent=name", () => {
		expect(agentTypeFromArgv(["pi", "--agent=scout"])).toBe("scout");
	});

	it("returns null when absent or the value is another flag", () => {
		expect(agentTypeFromArgv(["pi", "-p", "hello"])).toBeNull();
		expect(agentTypeFromArgv(["pi", "--agent", "--print"])).toBeNull();
	});
});

describe("modelSlug / normalizeThinkingLevel", () => {
	it("formats Pi model metadata as provider/model", () => {
		expect(modelSlug({ provider: "openai", id: "gpt-5.5" })).toBe("openai/gpt-5.5");
	});

	it("returns null for incomplete model metadata", () => {
		expect(modelSlug(null)).toBeNull();
		expect(modelSlug({ provider: "openai" })).toBeNull();
		expect(modelSlug({ provider: "openai", id: 42 })).toBeNull();
	});

	it("keeps non-empty thinking levels and normalizes missing values to null", () => {
		expect(normalizeThinkingLevel("low")).toBe("low");
		expect(normalizeThinkingLevel(" ")).toBeNull();
		expect(normalizeThinkingLevel(undefined)).toBeNull();
	});
});

describe("messageText / lastAssistantText", () => {
	it("joins text blocks and ignores thinking and tool calls", () => {
		expect(
			messageText({
				role: "assistant",
				content: [
					{ type: "thinking", text: "hidden" },
					{ type: "text", text: "part one" },
					{ type: "toolCall" },
					{ type: "text", text: "part two" },
				],
			}),
		).toBe("part one\npart two");
	});

	it("passes string content through", () => {
		expect(messageText({ role: "user", content: "hi" })).toBe("hi");
	});

	it("takes the last assistant message, skipping trailing non-assistant messages", () => {
		expect(
			lastAssistantText([
				{ role: "assistant", content: [{ type: "text", text: "preamble" }] },
				{ role: "toolResult", content: "output" },
				{ role: "assistant", content: [{ type: "text", text: "final answer" }] },
				{ role: "user", content: "steer" },
			]),
		).toBe("final answer");
	});

	it("returns empty string when no assistant message exists", () => {
		expect(lastAssistantText([{ role: "user", content: "hi" }])).toBe("");
		expect(lastAssistantText(undefined)).toBe("");
	});
});

describe("buildRecord", () => {
	it("produces schema-v1 records with event fields", () => {
		const envelope = {
			v: SCHEMA_VERSION,
			ts: "2026-07-02T10:00:00.000Z",
			session_id: "s1",
			prompt_id: "p1",
			cwd: "/repo",
			agent_id: null,
			agent_type: "main",
			model: "openai/gpt-5.5",
			thinking_level: "low",
		} as const;
		expect(buildRecord(envelope, "file", { tool: "Read", file_path: "/repo/a.ts" })).toEqual({
			...envelope,
			event: "file",
			tool: "Read",
			file_path: "/repo/a.ts",
		});
	});
});

describe("formatReport", () => {
	const envelope = {
		v: SCHEMA_VERSION,
		ts: "2026-07-02T10:00:00.000Z",
		session_id: "s1",
		prompt_id: "p1",
		cwd: "/repo",
		agent_id: null,
		agent_type: null,
		model: "openai/gpt-5.5",
		thinking_level: "low",
	} as const;

	it("summarizes counts and recent records", () => {
		const report = formatReport("/tmp/s1.jsonl", [
			buildRecord(envelope, "prompt", { text: "hello" }),
			buildRecord(envelope, "reply", { text: "world" }),
		]);
		expect(report).toContain("`/tmp/s1.jsonl`");
		expect(report).toContain("prompt: 1, reply: 1");
		expect(report).toContain("- `prompt` hello");
	});

	it("reports an empty log", () => {
		expect(formatReport("/tmp/s1.jsonl", [])).toContain("**Events:** none");
	});
});
