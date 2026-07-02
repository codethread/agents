/**
 * Dialogue capture — Pi counterpart of the Claude harness plugin's dialogue hooks.
 *
 * Appends schema-v1 records (prompts, final replies, file touches, session end)
 * to ${XDG_STATE_HOME:-~/.local/state}/pi-dialogue/<session-id>.jsonl so
 * downstream tooling can consume a stable log instead of parsing session files.
 * Schema reference: plugins/harness/README.md.
 *
 * Capture must never break the session: every write failure is swallowed.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { showDebugMessage } from "../components/debug-message/index.js";
import {
	agentTypeFromArgv,
	buildRecord,
	dialogueStateDir,
	type DialogueEvent,
	type DialogueRecord,
	type Envelope,
	FILE_TOOLS,
	formatReport,
	lastAssistantText,
	modelSlug,
	normalizeThinkingLevel,
	SCHEMA_VERSION,
} from "./capture.js";

const DEBUG_FLAG = "debug-dialogue-capture";

type BeforeAgentStartEvent = { prompt: string };
type AgentEndEvent = { messages: Array<{ role?: string; content?: unknown }> };
type ToolResultEvent = { toolName: string; input: Record<string, unknown>; isError: boolean };
type SessionShutdownEvent = { reason?: string };

function logPathFor(ctx: Pick<ExtensionContext, "sessionManager">): string {
	const sessionId = ctx.sessionManager.getSessionId() ?? "unknown";
	return join(dialogueStateDir(), `${sessionId}.jsonl`);
}

function readRecords(logPath: string): DialogueRecord[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as DialogueRecord);
}

export default function dialogueCaptureExtension(pi: ExtensionAPI) {
	const agentType = agentTypeFromArgv(process.argv);
	const isSubagent = process.env.PI_SUBAGENT === "1";
	let promptId: string | null = null;

	function envelope(ctx: Pick<ExtensionContext, "sessionManager" | "cwd" | "model">): Envelope {
		const sessionId = ctx.sessionManager.getSessionId() ?? "unknown";
		return {
			v: SCHEMA_VERSION,
			ts: new Date().toISOString(),
			session_id: sessionId,
			prompt_id: promptId,
			cwd: ctx.cwd ?? null,
			// Mirrors the Claude schema: agent_id null on the main thread. A pi
			// subagent is its own process/session, so its session id is the id.
			agent_id: isSubagent ? sessionId : null,
			agent_type: agentType,
			model: modelSlug(ctx.model),
			thinking_level: normalizeThinkingLevel(pi.getThinkingLevel()),
		};
	}

	function write(
		ctx: Pick<ExtensionContext, "sessionManager" | "cwd" | "model">,
		event: DialogueEvent,
		fields: Partial<Pick<DialogueRecord, "text" | "tool" | "file_path" | "reason">>,
	): void {
		try {
			const dir = dialogueStateDir();
			mkdirSync(dir, { recursive: true });
			const record = buildRecord(envelope(ctx), event, fields);
			appendFileSync(join(dir, `${record.session_id}.jsonl`), `${JSON.stringify(record)}\n`);
		} catch {
			// capture is best-effort; never disturb the session
		}
	}

	pi.registerFlag(DEBUG_FLAG, {
		description: "Print dialogue-capture log path and captured events, then exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		promptId = null;
		if (pi.getFlag(DEBUG_FLAG) !== true) return;
		try {
			const logPath = logPathFor(ctx);
			process.stdout.write(`${formatReport(logPath, readRecords(logPath))}\n`);
			process.exit(0);
		} catch (error) {
			process.stderr.write(`[dialogue-capture] ${String(error)}\n`);
			process.exit(1);
		}
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent, ctx) => {
		promptId = randomUUID();
		write(ctx, "prompt", { text: event.prompt });
	});

	pi.on("agent_end", (event: AgentEndEvent, ctx) => {
		const text = lastAssistantText(event.messages);
		if (!text) return;
		write(ctx, "reply", { text });
	});

	pi.on("tool_result", (event: ToolResultEvent, ctx) => {
		const tool = FILE_TOOLS[event.toolName];
		if (!tool || event.isError) return;
		const path = event.input.path;
		write(ctx, "file", { tool, file_path: typeof path === "string" ? path : null });
	});

	pi.on("session_shutdown", (event: SessionShutdownEvent, ctx) => {
		write(ctx, "session_end", { reason: event.reason ?? null });
	});

	pi.registerCommand("debug-dialogue-capture", {
		description: "Show the current session's dialogue-capture log in a debug panel",
		handler: async (_args, ctx) => {
			try {
				const logPath = logPathFor(ctx);
				const content = formatReport(logPath, readRecords(logPath));
				if (ctx.hasUI) {
					await showDebugMessage(ctx, {
						headingText: "Dialogue Capture",
						subheadingText: "schema-v1 dialogue log for this session",
						markdownBody: content,
						sendMarkdownToAgent: async (markdownBody) => {
							await pi.sendUserMessage(markdownBody);
						},
					});
					return;
				}
				process.stdout.write(`${content}\n`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[dialogue-capture] ${message}`, "error");
				else process.stderr.write(`[dialogue-capture] ${message}\n`);
			}
		},
	});
}
