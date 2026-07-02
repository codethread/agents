import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Dialogue-capture schema v1, shared with the Claude harness plugin
 * (plugins/harness/README.md is the schema reference). Changes must be
 * additive only: downstream jq/devflow tooling relies on these shapes.
 */
export const SCHEMA_VERSION = 1;

export type DialogueEvent = "prompt" | "reply" | "file" | "session_end";

export type DialogueRecord = {
	v: typeof SCHEMA_VERSION;
	event: DialogueEvent;
	ts: string;
	session_id: string;
	prompt_id: string | null;
	cwd: string | null;
	agent_id: string | null;
	agent_type: string | null;
	text?: string;
	tool?: string;
	file_path?: string | null;
	reason?: string | null;
};

export type Envelope = Omit<DialogueRecord, "event" | "text" | "tool" | "file_path" | "reason">;

/** Pi builtin tool names → the schema's Claude-style tool labels. */
export const FILE_TOOLS: Record<string, string> = {
	read: "Read",
	edit: "Edit",
	write: "Write",
};

export function dialogueStateDir(env: NodeJS.ProcessEnv = process.env): string {
	const base = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
	return join(base, "pi-dialogue");
}

/** Extract the `--agent <name>` / `--agent=<name>` value from a pi argv. */
export function agentTypeFromArgv(argv: readonly string[]): string | null {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--agent") {
			const value = argv[i + 1]?.trim();
			return value && !value.startsWith("-") ? value : null;
		}
		if (arg.startsWith("--agent=")) {
			const value = arg.slice("--agent=".length).trim();
			return value ? value : null;
		}
	}
	return null;
}

type MessageLike = { role?: string; content?: unknown };

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
	return (
		typeof block === "object" &&
		block !== null &&
		(block as { type?: unknown }).type === "text" &&
		typeof (block as { text?: unknown }).text === "string"
	);
}

/** Visible text of one message: string content as-is, arrays joined over text blocks. */
export function messageText(message: MessageLike | undefined): string {
	if (!message) return "";
	const { content } = message;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(isTextBlock)
		.map((block) => block.text)
		.join("\n");
}

/** Final reply of a prompt: text of the last assistant message, "" when absent. */
export function lastAssistantText(messages: readonly MessageLike[] | undefined): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") return messageText(messages[i]);
	}
	return "";
}

export function buildRecord(
	envelope: Envelope,
	event: DialogueEvent,
	fields: Partial<Pick<DialogueRecord, "text" | "tool" | "file_path" | "reason">>,
): DialogueRecord {
	return { ...envelope, event, ...fields };
}

export function formatReport(logPath: string, records: DialogueRecord[]): string {
	const counts = new Map<string, number>();
	for (const record of records) counts.set(record.event, (counts.get(record.event) ?? 0) + 1);
	const countLine =
		[...counts.entries()].map(([event, count]) => `${event}: ${count}`).join(", ") || "none";
	const tail = records
		.slice(-10)
		.map((record) => {
			const value = record.text ?? record.file_path ?? record.reason ?? "";
			const preview = value.length > 100 ? `${value.slice(0, 100)}…` : value;
			return `- \`${record.event}\`${record.tool ? ` (${record.tool})` : ""} ${preview}`;
		})
		.join("\n");
	return [
		`**Log:** \`${logPath}\``,
		`**Events:** ${countLine}`,
		...(tail ? ["", "**Recent records:**", tail] : []),
	].join("\n");
}
