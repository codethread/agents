import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildSessionContext,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { matchesKey } from "@earendil-works/pi-tui";

const PROMPT_START = "<!-- pi:prompt:start -->";
const PROMPT_END = "<!-- pi:prompt:end -->";
const TOOL_PREVIEW_LINES = 5;

type TranscriptMessage = AgentMessage;
type TranscriptContent = Extract<TranscriptMessage, { content: unknown }>["content"];

type OpenEditorState = {
	dir: string;
	file: string;
	saveMarker: string;
};

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getText(content: TranscriptContent): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text.trim())
		.filter(Boolean)
		.join("\n")
		.trim();
}

function compactOneLine(value: unknown, maxLength = 240): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	text = text.replace(/\s+/g, " ").trim();
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatToolCall(name: string, args: ToolCall["arguments"]): string {
	const values = args;
	switch (name) {
		case "bash":
			return typeof values.command === "string"
				? values.command.trim()
				: compactOneLine(values.command ?? args);
		case "read":
			return `read ${compactOneLine(values.path ?? values.file_path ?? "")}`.trimEnd();
		case "write":
			return `write ${compactOneLine(values.path ?? values.file_path ?? "")}`.trimEnd();
		case "edit":
			return `edit ${compactOneLine(values.path ?? values.file_path ?? "")}`.trimEnd();
		case "grep":
			return `grep /${compactOneLine(values.pattern ?? "")}/ in ${compactOneLine(values.path ?? ".")}`;
		case "find":
			return `find ${compactOneLine(values.pattern ?? "")} in ${compactOneLine(values.path ?? ".")}`;
		case "ls":
			return `ls ${compactOneLine(values.path ?? ".")}`;
		default: {
			const summary = compactOneLine(args);
			return summary && summary !== "{}" ? `${name} ${summary}` : name;
		}
	}
}

function fencedCode(language: string, text: string): string {
	return `\`\`\`${language}\n${text}\n\`\`\``;
}

function indentBlock(text: string): string {
	return text
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}

function formatToolOutput(
	content: ToolResultMessage["content"] | string | undefined,
	isError = false,
): string {
	if (!content) return "_No result recorded._";
	const output = getText(content).replace(/\r\n?/g, "\n").trimEnd();
	if (!output) return isError ? "_Tool failed without text output._" : "_No output._";

	const lines = output.split("\n");
	const visible = lines.slice(-TOOL_PREVIEW_LINES);
	const hidden = lines.length - visible.length;
	const prefix = hidden > 0 ? `_… ${hidden} earlier lines hidden._\n\n` : "";
	return `${prefix}${indentBlock(visible.join("\n"))}`;
}

export function formatScrollback(messages: readonly TranscriptMessage[]): string {
	const toolResults = new Map<string, ToolResultMessage>();
	for (const message of messages) {
		if (message.role === "toolResult") {
			toolResults.set(message.toolCallId, message);
		}
	}

	const sections: string[] = [];
	for (const message of messages) {
		switch (message.role) {
			case "user": {
				const text = getText(message.content);
				if (text) sections.push(`# User\n\n${text}`);
				break;
			}
			case "assistant": {
				const blocks = Array.isArray(message.content) ? message.content : [];
				const text = getText(message.content);
				const parts: string[] = [];
				const hasThinking = blocks.some(
					(block) => block.type === "thinking" && typeof block.thinking === "string",
				);
				const visibleAssistant = [text, hasThinking ? "> Thinking… _(collapsed)_" : ""]
					.filter(Boolean)
					.join("\n\n");
				if (visibleAssistant) parts.push(`# Assistant\n\n${visibleAssistant}`);
				for (const block of blocks) {
					if (block.type !== "toolCall" || !block.id || !block.name) continue;
					const call = formatToolCall(block.name, block.arguments);
					const renderedCall = block.name === "bash" ? fencedCode("bash", call) : indentBlock(call);
					const result = toolResults.get(block.id);
					parts.push(
						`### Tool · ${block.name}\n\n${renderedCall}\n\n${formatToolOutput(result?.content, result?.isError)}`,
					);
				}
				if (parts.length > 0) sections.push(parts.join("\n\n"));
				break;
			}
			case "toolResult":
				break;
			case "bashExecution": {
				const status = message.cancelled
					? "cancelled"
					: message.exitCode === undefined
						? "unknown status"
						: `exit ${message.exitCode}`;
				sections.push(
					`### Shell · ${status}\n\n${fencedCode("bash", message.command.trim())}\n\n${formatToolOutput(message.output, message.cancelled || message.exitCode !== 0)}`,
				);
				break;
			}
			case "custom": {
				if (!message.display) break;
				const text = getText(message.content);
				if (text) sections.push(`### ${message.customType ?? "Notice"}\n\n${text}`);
				break;
			}
			case "compactionSummary":
				if (message.summary) sections.push(`# Compaction summary\n\n${message.summary}`);
				break;
			case "branchSummary":
				if (message.summary) sections.push(`# Branch summary\n\n${message.summary}`);
				break;
		}
	}

	return sections.join("\n\n---\n\n").trim();
}

export function buildEditorBody(scrollback: string, prompt: string): string {
	const history = scrollback || "# Pi session scrollback\n\n_No session messages yet._";
	return `${history.trimEnd()}\n\n---\n\n${PROMPT_START}\n${prompt}\n${PROMPT_END}\n`;
}

export function extractPrompt(editorBody: string): string | undefined {
	const start = editorBody.lastIndexOf(PROMPT_START);
	if (start === -1) return undefined;
	const contentStart = start + PROMPT_START.length;
	const end = editorBody.indexOf(PROMPT_END, contentStart);
	if (end === -1) return undefined;

	let prompt = editorBody.slice(contentStart, end);
	if (prompt.startsWith("\n")) prompt = prompt.slice(1);
	if (prompt.endsWith("\n")) prompt = prompt.slice(0, -1);
	return prompt;
}

function getScrollback(ctx: ExtensionContext): string {
	return formatScrollback(buildSessionContext(ctx.sessionManager.getBranch()).messages);
}

async function createEditorFiles(body: string): Promise<OpenEditorState> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-scrollback-editor-"));
	const file = path.join(dir, "session.md");
	const saveMarker = path.join(dir, "saved");
	await fs.writeFile(file, body, "utf-8");
	return { dir, file, saveMarker };
}

class ScrollbackEditor extends CustomEditor {
	private openEditor?: OpenEditorState;

	constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		getContext: () => ExtensionContext,
	) {
		super(tui, theme, keybindings);
		this.getContext = getContext;
	}

	private readonly getContext: () => ExtensionContext;

	override handleInput(data: string): void {
		if (matchesKey(data, "ctrl+g")) {
			void this.openScrollbackEditor();
			return;
		}
		super.handleInput(data);
	}

	private notify(message: string, level: "info" | "warning" | "error" = "info"): void {
		this.getContext().ui.notify(message, level);
	}

	private async openScrollbackEditor(): Promise<void> {
		if (this.openEditor) {
			this.notify("Scrollback editor is already open", "warning");
			return;
		}

		try {
			const ctx = this.getContext();
			const initialPrompt = this.getExpandedText();
			const scrollback = getScrollback(ctx);
			const state = await createEditorFiles(buildEditorBody(scrollback, initialPrompt));
			this.openEditor = state;
			this.tui.stop();
			const child = spawn("nvim", [state.file], {
				stdio: "inherit",
				env: {
					...process.env,
					PI_SCROLLBACK_FILE: state.file,
					PI_SCROLLBACK_SAVE_MARKER: state.saveMarker,
				},
			});

			child.once("error", (error) => void this.finishEdit(error));
			child.once("exit", (status, signal) => {
				const error = signal
					? new Error(`Neovim terminated by signal ${signal}`)
					: status === 0
						? undefined
						: new Error(`Neovim exited with status ${status ?? "unknown"}`);
				void this.finishEdit(error);
			});
		} catch (error) {
			await this.finishEdit(error);
		}
	}

	private async finishEdit(error?: unknown): Promise<void> {
		const state = this.openEditor;
		this.openEditor = undefined;

		try {
			if (error) {
				this.notify(`Scrollback editor failed: ${getErrorMessage(error)}`, "error");
				return;
			}
			if (!state) return;

			const wasSaved = await fs
				.access(state.saveMarker)
				.then(() => true)
				.catch(() => false);
			if (!wasSaved) {
				this.notify("Closed without saving; kept the existing Pi prompt");
				return;
			}

			const body = await fs.readFile(state.file, "utf-8");
			const prompt = extractPrompt(body);
			if (prompt === undefined) {
				this.notify(
					"Saved file is missing the prompt markers; kept the existing Pi prompt",
					"warning",
				);
				return;
			}

			this.setText(prompt);
			this.notify("Applied the saved prompt from Neovim");
		} finally {
			if (state) await fs.rm(state.dir, { recursive: true, force: true });
			this.tui.start();
			this.tui.requestRender(true);
		}
	}
}

export default function scrollbackEditorExtension(pi: ExtensionAPI) {
	pi.registerFlag("debug-scrollback-editor", {
		description: "Print scrollback editor configuration and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (pi.getFlag("debug-scrollback-editor") === true) {
			process.stdout.write(
				`${JSON.stringify(
					{
						enabled: true,
						binding: "ctrl+g",
						command: "nvim",
						usesUserConfig: true,
						toolPreviewLines: TOOL_PREVIEW_LINES,
						promptMarkers: [PROMPT_START, PROMPT_END],
					},
					null,
					2,
				)}\n`,
			);
			process.exit(0);
		}

		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new ScrollbackEditor(tui, theme, keybindings, () => ctx),
		);
	});
}
