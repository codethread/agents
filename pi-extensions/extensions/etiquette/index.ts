import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	buildEtiquetteArgs,
	ETIQUETTE_CHILD_MODEL,
	ETIQUETTE_CHILD_SYSTEM_PROMPT,
	extractFinalAssistantTextFromPrintOutput,
	shouldExposeEtiquetteTool,
	shouldRunEtiquetteCompaction,
} from "./etiquette.js";

const ETIQUETTE_TOOL_NAME = "etiquette";

const EtiquetteParams = Type.Object({
	message: Type.String({ description: "Message to compact before returning it to the user" }),
});

interface EtiquetteDetails {
	draft: string;
	compacted: string;
	exitCode: number | null;
	stderr: string;
	cancelled: boolean;
}

function getExplicitEtiquettePreference(argv: string[]): boolean | undefined {
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--no-tools") return false;
		if (arg === "--tools") {
			const value = argv[i + 1];
			if (!value) return false;
			return value
				.split(",")
				.map((tool) => tool.trim())
				.includes(ETIQUETTE_TOOL_NAME);
		}
		if (arg.startsWith("--tools=")) {
			return arg
				.slice("--tools=".length)
				.split(",")
				.map((tool) => tool.trim())
				.includes(ETIQUETTE_TOOL_NAME);
		}
	}
	return undefined;
}

function formatToolText(result: { content?: Array<{ type: string; text?: string }> }): string {
	const first = result.content?.find((item) => item.type === "text");
	return first?.type === "text" ? (first.text ?? "") : "";
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/u.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

async function writeSystemPromptToTempFile(): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-etiquette-"));
	const filePath = path.join(dir, "system-prompt.md");
	await fs.writeFile(filePath, `${ETIQUETTE_CHILD_SYSTEM_PROMPT}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	return { dir, filePath };
}

async function cleanupTempFile(dir: string | null, filePath: string | null) {
	if (filePath) {
		try {
			await fs.unlink(filePath);
		} catch {
			// ignore cleanup failures
		}
	}

	if (dir) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup failures
		}
	}
}

async function runEtiquetteChild(
	message: string,
	signal: AbortSignal | undefined,
	cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; killed: boolean }> {
	let tmpDir: string | null = null;
	let tmpFilePath: string | null = null;

	try {
		const tmp = await writeSystemPromptToTempFile();
		tmpDir = tmp.dir;
		tmpFilePath = tmp.filePath;
		const args = buildEtiquetteArgs(message, ETIQUETTE_CHILD_MODEL, tmpFilePath);
		const invocation = getPiInvocation(args);

		return await new Promise((resolve) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let abortHandler: (() => void) | undefined;

			const cleanup = () => {
				if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
			};

			if (signal) {
				abortHandler = () => {
					if (!proc.killed) proc.kill("SIGTERM");
				};
				signal.addEventListener("abort", abortHandler, { once: true });
			}

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				cleanup();
				resolve({ stdout, stderr: stderr.trim(), exitCode: code, killed: proc.killed });
			});

			proc.on("error", (error) => {
				cleanup();
				resolve({
					stdout,
					stderr: stderr ? `${stderr.trim()}\n${error.message}` : error.message,
					exitCode: 1,
					killed: proc.killed,
				});
			});
		});
	} finally {
		await cleanupTempFile(tmpDir, tmpFilePath);
	}
}

export default function etiquette(pi: ExtensionAPI) {
	let restoreWhenEligible = true;

	const syncAvailability = (modelId: string | null | undefined) => {
		const activeTools = pi.getActiveTools();
		const hasTool = activeTools.includes(ETIQUETTE_TOOL_NAME);
		const shouldExpose = shouldExposeEtiquetteTool(modelId);
		if (!shouldExpose) {
			if (hasTool) {
				pi.setActiveTools(activeTools.filter((tool) => tool !== ETIQUETTE_TOOL_NAME));
			}
			return;
		}
		if (!hasTool && restoreWhenEligible) {
			pi.setActiveTools([...activeTools, ETIQUETTE_TOOL_NAME]);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		const explicitPreference = getExplicitEtiquettePreference(process.argv.slice(2));
		restoreWhenEligible = explicitPreference ?? pi.getActiveTools().includes(ETIQUETTE_TOOL_NAME);
		syncAvailability(ctx.model?.id);
	});

	pi.on("model_select", (event) => {
		syncAvailability(event.model?.id);
	});

	pi.registerTool({
		name: ETIQUETTE_TOOL_NAME,
		label: "Etiquette",
		description:
			"Compact a drafted user-facing message and return the exact text to send. Use this immediately before yielding a message back to the user; after calling it, send the returned text verbatim and stop with no further action. Messages of 50 lines or fewer are returned unchanged.",
		promptSnippet: "Compact a drafted user-facing message and return the exact text to send",
		parameters: EtiquetteParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("Etiquette cancelled.");
			}

			if (!shouldRunEtiquetteCompaction(params.message)) {
				return {
					content: [{ type: "text", text: params.message }],
					details: {
						draft: params.message,
						compacted: params.message,
						exitCode: null,
						stderr: "",
						cancelled: false,
					} satisfies EtiquetteDetails,
				};
			}

			onUpdate?.({ content: [{ type: "text", text: "Compacting message..." }], details: {} });

			const result = await runEtiquetteChild(params.message, signal, ctx.cwd);
			const finalText = extractFinalAssistantTextFromPrintOutput(result.stdout);

			if (signal?.aborted) {
				throw new Error("Etiquette cancelled.");
			}

			if ((result.exitCode ?? 1) !== 0) {
				const message =
					result.stderr || `Child pi exited with code ${result.exitCode ?? "unknown"}`;
				throw new Error(`Etiquette failed: ${message}`);
			}

			if (!finalText) {
				throw new Error("Etiquette failed: child pi returned no assistant text.");
			}

			return {
				content: [{ type: "text", text: finalText }],
				details: {
					draft: params.message,
					compacted: finalText,
					exitCode: result.exitCode,
					stderr: result.stderr,
					cancelled: false,
				} satisfies EtiquetteDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("etiquette")), 0, 0);
		},

		renderResult(result, options, theme, context) {
			if (options.isPartial) {
				return new Text(theme.fg("warning", "Compacting message..."), 0, 0);
			}

			if (context.isError) {
				return new Text(theme.fg("error", formatToolText(result) || "etiquette failed"), 0, 0);
			}

			const details = result.details as EtiquetteDetails | undefined;
			const compacted = details?.compacted || formatToolText(result);
			if (!options.expanded || !details?.draft || details.draft.trim() === compacted.trim()) {
				let text = theme.fg("toolOutput", compacted || "(empty)");
				if (details?.draft && details.draft.trim() !== compacted.trim()) {
					text += `\n${theme.fg("muted", "Ctrl+o: view original draft")}`;
				}
				return new Text(text, 0, 0);
			}

			const text = [
				theme.fg("toolOutput", compacted || "(empty)"),
				"",
				theme.fg("muted", "Original draft:"),
				theme.fg("dim", details.draft),
			].join("\n");
			return new Text(text, 0, 0);
		},
	});
}
