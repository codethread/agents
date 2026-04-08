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

// Types
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface QuestionInput {
	id: string;
	label?: string;
	prompt: string;
	context?: string;
	options: QuestionOption[];
	allowOther?: boolean;
}

interface Question {
	id: string;
	label: string;
	prompt: string;
	context?: string;
	options: QuestionOption[];
	allowOther: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

interface ParseError {
	questionId: string;
	questionLabel: string;
	message: string;
}

interface ParseResult {
	answers: Answer[];
	errors: ParseError[];
}

// Schema
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
			description:
				"Per-question context included in that question's markdown section",
		}),
	),
	options: Type.Array(QuestionOptionSchema, {
		minItems: 1,
		description:
			"Required list of predefined options to choose from. At least one option must be provided. Each needs a value and label.",
	}),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Allow an 'Other' custom response option (default: true)" }),
	),
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

const VALIDATION_START = "<!-- questionnaire-errors:start -->";
const VALIDATION_END = "<!-- questionnaire-errors:end -->";
const VALIDATION_BANNER_RE = new RegExp(
	`${escapeRegex(VALIDATION_START)}[\\s\\S]*?${escapeRegex(VALIDATION_END)}\\s*`,
	"g",
);

function errorResult(
	message: string,
	questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

function normalizeQuestions(rawQuestions: QuestionInput[]): Question[] {
	return rawQuestions.map((question, index) => ({
		...question,
		label: question.label || `Q${index + 1}`,
		allowOther: question.allowOther !== false,
	}));
}

function getEditorCommand(): string | undefined {
	const visual = process.env.VISUAL?.trim();
	if (visual) return visual;
	const editor = process.env.EDITOR?.trim();
	if (editor) return editor;
	return undefined;
}

function openExternalEditor(editorCommand: string, filePath: string): { ok: true } | { ok: false; message: string } {
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

function renderQuestionnaireMarkdown(topContext: string | undefined, questions: Question[]): string {
	const lines: string[] = [];

	lines.push("# Questionnaire");
	lines.push("");
	lines.push("Complete each question by editing the `<user_response>` block in place:");
	lines.push("- Check exactly one option per question by changing `[ ]` to `[x]`.");
	lines.push("- If you check `Other`, provide custom text inside the fenced block.");
	lines.push("- Save and exit the editor to submit.");
	lines.push("- Exit the editor with a non-zero status to cancel.");

	if (topContext) {
		lines.push("");
		lines.push("## Context");
		lines.push("");
		lines.push(topContext);
	}

	for (const [index, question] of questions.entries()) {
		const defaultLabel = `Q${index + 1}`;
		const heading = question.label === defaultLabel ? question.label : `${defaultLabel} — ${question.label}`;

		lines.push("");
		lines.push("---");
		lines.push(`<!-- questionnaire-question:${question.id} -->`);
		lines.push(`## ${heading}`);
		lines.push("");
		lines.push(question.prompt);

		if (question.context) {
			lines.push("");
			lines.push(question.context);
		}

		lines.push("");
		lines.push("<user_response>");
		for (const [optionIndex, option] of question.options.entries()) {
			lines.push(`- [ ] ${optionIndex + 1}. ${option.label}`);
			if (option.description) {
				for (const descriptionLine of option.description.split(/\r?\n/g)) {
					lines.push(`  ${descriptionLine}`);
				}
			}
		}

		if (question.allowOther) {
			const otherIndex = question.options.length + 1;
			lines.push(`- [ ] ${otherIndex}. Other`);
			lines.push("");
			lines.push("```text");
			lines.push("");
			lines.push("```");
		}

		lines.push("</user_response>");
	}

	lines.push("");
	return lines.join("\n");
}

function stripValidationBanner(markdown: string): string {
	return markdown.replace(VALIDATION_BANNER_RE, "").trimStart();
}

function addValidationBanner(markdown: string, errors: ParseError[]): string {
	const cleaned = stripValidationBanner(markdown);
	if (errors.length === 0) return cleaned;

	const bannerLines: string[] = [
		VALIDATION_START,
		"## ⚠ Validation errors",
		"",
		"Please fix the items below, then save and exit again:",
		"",
		...errors.map(
			(error) =>
				`- **${error.questionLabel}** (\`${error.questionId}\`): ${error.message}`,
		),
		"",
		"To cancel, exit the editor with a non-zero status.",
		VALIDATION_END,
	];

	return `${bannerLines.join("\n")}\n\n${cleaned}`;
}

function parseAnswers(markdown: string, questions: Question[]): ParseResult {
	const answers: Answer[] = [];
	const errors: ParseError[] = [];

	for (const question of questions) {
		const sectionResult = extractQuestionSection(markdown, question.id);
		if ("error" in sectionResult) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: sectionResult.error,
			});
			continue;
		}

		const responseResult = extractResponseBlock(sectionResult.section);
		if ("error" in responseResult) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: responseResult.error,
			});
			continue;
		}

		const selectionResult = parseSelection(responseResult.responseBlock);
		if ("error" in selectionResult) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: selectionResult.error,
			});
			continue;
		}

		const selectedIndex = selectionResult.selectedIndex;
		const maxIndex = question.options.length + (question.allowOther ? 1 : 0);
		if (selectedIndex < 1 || selectedIndex > maxIndex) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: `selected option ${selectedIndex} is out of range`,
			});
			continue;
		}

		if (selectedIndex <= question.options.length) {
			const option = question.options[selectedIndex - 1];
			answers.push({
				id: question.id,
				value: option.value,
				label: option.label,
				wasCustom: false,
				index: selectedIndex,
			});
			continue;
		}

		if (!question.allowOther) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: "custom response selected but this question does not allow Other",
			});
			continue;
		}

		const customValue = extractCustomResponse(responseResult.responseBlock);
		if (!customValue) {
			errors.push({
				questionId: question.id,
				questionLabel: question.label,
				message: "selected Other but custom response text is empty",
			});
			continue;
		}

		answers.push({
			id: question.id,
			value: customValue,
			label: customValue,
			wasCustom: true,
		});
	}

	return { answers, errors };
}

function extractQuestionSection(
	markdown: string,
	questionId: string,
): { section: string } | { error: string } {
	const marker = `<!-- questionnaire-question:${questionId} -->`;
	const firstMarkerIndex = markdown.indexOf(marker);
	if (firstMarkerIndex === -1) {
		return { error: "missing question marker section" };
	}

	if (markdown.indexOf(marker, firstMarkerIndex + marker.length) !== -1) {
		return { error: "question marker appears multiple times" };
	}

	const separatorRegex = /^---\s*$/gm;
	separatorRegex.lastIndex = firstMarkerIndex + marker.length;
	const nextSeparator = separatorRegex.exec(markdown);
	const sectionEnd = nextSeparator ? nextSeparator.index : markdown.length;
	return { section: markdown.slice(firstMarkerIndex, sectionEnd) };
}

function extractResponseBlock(section: string): { responseBlock: string } | { error: string } {
	const matches = Array.from(section.matchAll(/<user_response>([\s\S]*?)<\/user_response>/g));
	if (matches.length === 0) {
		return { error: "missing <user_response> block" };
	}
	if (matches.length > 1) {
		return { error: "multiple <user_response> blocks found" };
	}
	return { responseBlock: matches[0][1] };
}

function parseSelection(responseBlock: string): { selectedIndex: number } | { error: string } {
	const checkedIndexes: number[] = [];
	const checkboxPattern = /^\s*-\s*\[(x|X| )\]\s+(\d+)\.\s+.+$/gm;

	for (const match of responseBlock.matchAll(checkboxPattern)) {
		if (match[1].toLowerCase() !== "x") continue;
		checkedIndexes.push(Number(match[2]));
	}

	if (checkedIndexes.length === 0) {
		return { error: "select exactly one option (none selected)" };
	}
	if (checkedIndexes.length > 1) {
		return { error: "select exactly one option (multiple selected)" };
	}
	return { selectedIndex: checkedIndexes[0] };
}

function extractCustomResponse(responseBlock: string): string | null {
	const fenced = responseBlock.match(/```(?:text)?[^\n\r]*\r?\n([\s\S]*?)\r?\n```/m);
	if (!fenced) return null;

	const trimmed = fenced[1].trim();
	return trimmed.length > 0 ? trimmed : null;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
			let markdown = renderQuestionnaireMarkdown(params.context, questions);

			try {
				await fs.promises.writeFile(formPath, markdown, "utf-8");

				for (;;) {
					const editorResult = openExternalEditor(editorCommand, formPath);
					if (!editorResult.ok) {
						return errorResult(
							`Questionnaire cancelled: ${editorResult.message}`,
							questions,
						);
					}

					markdown = await fs.promises.readFile(formPath, "utf-8");
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
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
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
