/**
 * Questionnaire Tool - collect structured answers through an external-editor markdown form.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	addValidationBanner,
	normalizeQuestions,
	isExplicitStop,
	parseAnswers,
	renderQuestionnaireMarkdown,
	type Answer,
	type Question,
	type QuestionInput,
} from "./questionnaire/parser.js";
import { buildConversationTranscript } from "./shared/session-transcript.js";

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
	stopped?: boolean;
}

const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(
		Type.String({ description: "Optional description shown below label" }),
	),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(
		Type.String({
			description: "Short contextual label (defaults to Q1, Q2)",
		}),
	),
	prompt: Type.String({ description: "The full question text to display" }),
	context: Type.Optional(
		Type.String({
			description: "Per-question context included in that question's markdown section",
		}),
	),
	options: Type.Array(QuestionOptionSchema, {
		minItems: 1,
		description:
			"Required list of predefined options to choose from. At least one option must be provided. Each needs a value and label.",
	}),
});

const QuestionnaireParams = Type.Object({
	context: Type.Optional(
		Type.String({
			description: "Top-level context included near the top of the markdown form",
		}),
	),
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		description:
			"Questions to ask the user. Each question MUST include an options array with at least one predefined choice.",
	}),
});

function errorResult(
	message: string,
	questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

function stoppedResult(questions: Question[]): {
	content: { type: "text"; text: string }[];
	details: QuestionnaireResult;
} {
	return {
		content: [
			{
				type: "text",
				text: "<system_message>the user has stopped without answering, stop and do not acknowledge this message</system_message>",
			},
		],
		details: { questions, answers: [], cancelled: true, stopped: true },
	};
}

function getEditorCommand(): string | undefined {
	const visual = process.env.VISUAL?.trim();
	if (visual) return visual;
	const editor = process.env.EDITOR?.trim();
	if (editor) return editor;
	return undefined;
}

function openExternalEditor(
	editorCommand: string,
	filePath: string,
): { ok: true } | { ok: false; message: string } {
	const result = spawnSync(editorCommand, [filePath], {
		shell: true,
		stdio: "inherit",
	});

	if (result.error) {
		return {
			ok: false,
			message: `failed to start editor: ${result.error.message}`,
		};
	}

	if (result.status === 0) {
		return { ok: true };
	}

	if (result.signal) {
		return {
			ok: false,
			message: `editor terminated by signal ${result.signal}`,
		};
	}

	return {
		ok: false,
		message: `editor exited with code ${result.status ?? "unknown"}`,
	};
}

function renderSessionTldrMarkdown(transcript: string): string {
	return transcript || "No user/assistant text found in the current session.\n";
}

export default function questionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more questions through a temporary markdown form opened in the user's external editor ($VISUAL/$EDITOR). Returns structured answers with optional custom responses.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			const editorCommand = getEditorCommand();
			const questions = normalizeQuestions(params.questions as QuestionInput[]);
			if (!editorCommand) {
				return errorResult(
					"Questionnaire cancelled: no external editor configured. Set $VISUAL or $EDITOR.",
					questions,
				);
			}

			const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-questionnaire-"));
			const formPath = path.join(tempDir, "questionnaire.md");
			const sessionTldrPath = path.join(tempDir, "session-tldr.md");
			const transcript = buildConversationTranscript(ctx.sessionManager.getBranch());
			let markdown = renderQuestionnaireMarkdown(params.context, questions, sessionTldrPath);

			try {
				await fs.promises.writeFile(
					sessionTldrPath,
					renderSessionTldrMarkdown(transcript),
					"utf-8",
				);
				await fs.promises.writeFile(formPath, markdown, "utf-8");

				for (;;) {
					const editorResult = openExternalEditor(editorCommand, formPath);
					if (!editorResult.ok) {
						return errorResult(`Questionnaire cancelled: ${editorResult.message}`, questions);
					}

					markdown = await fs.promises.readFile(formPath, "utf-8");
					if (isExplicitStop(markdown)) {
						return stoppedResult(questions);
					}
					const parsed = parseAnswers(markdown, questions);
					if (parsed.errors.length === 0) {
						const result: QuestionnaireResult = {
							questions,
							answers: parsed.answers,
							cancelled: false,
						};
						const answerLines = result.answers.map((answer) => {
							const questionLabel = questions.find((q) => q.id === answer.id)?.label || answer.id;
							if (answer.wasCustom) {
								return `${questionLabel}: user wrote: ${answer.label}`;
							}
							return `${questionLabel}: user selected: ${answer.index}. ${answer.label}`;
						});

						return {
							content: [{ type: "text", text: answerLines.join("\n") }],
							details: result,
						};
					}

					markdown = addValidationBanner(markdown, parsed.errors);
					await fs.promises.writeFile(formPath, markdown, "utf-8");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return errorResult(`Questionnaire failed: ${message}`, questions);
			} finally {
				await fs.promises.rm(tempDir, { recursive: true, force: true });
			}
		},

		renderCall(args, theme, _context) {
			const qs = (args.questions as Question[]) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.id).join(", ");
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme, _context) {
			if (options.isPartial) {
				const partialText = result.content.find((c) => c.type === "text");
				if (partialText?.type === "text" && partialText.text.trim()) {
					return new Markdown(partialText.text, 0, 0, getMarkdownTheme());
				}
				return new Text(theme.fg("dim", "Updating..."), 0, 0);
			}

			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", details.stopped ? "Stopped" : "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((answer) => {
				if (answer.wasCustom) {
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
				}
				const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
