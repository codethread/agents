/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions
 *
 * Single question: simple options list
 * Multiple questions: tab bar navigation between questions
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ExtensionAPI, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	Markdown,
	matchesKey,
	Text,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

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
			description:
				"Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
		}),
	),
	prompt: Type.String({ description: "The full question text to display" }),
	context: Type.Optional(
		Type.String({
			description:
				"Per-question context shown when this tab is active. Brief relevant detail, file refs in vim-style (path:line)",
		}),
	),
	options: Type.Array(QuestionOptionSchema, {
		minItems: 1,
		description:
			"Required list of predefined options to choose from. At least one option must be provided. Each needs a value and label.",
	}),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Allow 'Type something' option (default: true)" }),
	),
});

const QuestionnaireParams = Type.Object({
	context: Type.Optional(
		Type.String({
			description:
				"Top-level overview briefing shown above all questions. Problem statement, key constraints, and file refs (vim-style path:line). Max ~10 lines.",
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

export default function questionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface. Supports optional context briefings at two levels: a top-level overview (always visible) and per-question detail (visible on active tab). Use context to share relevant background, constraints, and file references (vim-style path:line) so the user can make informed decisions.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			// Normalize questions with defaults
			const topContext = params.context;
			const questions: Question[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
				context: q.context,
				allowOther: q.allowOther !== false,
			}));

			const isMulti = questions.length > 1;
			const totalTabs = questions.length + 1; // questions + Submit
			const hasExternalEditor = !!(process.env.VISUAL || process.env.EDITOR);

			const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, kb, done) => {
				// State
				let currentTab = 0;
				let optionIndex = 0;
				let inputMode = false;
				let inputQuestionId: string | null = null;
				let cachedLines: string[] | undefined;
				const answers = new Map<string, Answer>();

				// Markdown rendering for context blocks
				const mdTheme = getMarkdownTheme();

				function renderContextMarkdown(text: string, width: number, indent: number): string[] {
					const md = new Markdown(text, 0, 0, mdTheme, {
						color: (t) => theme.fg("muted", t),
					});
					const rendered = md.render(width - indent);
					const pad = " ".repeat(indent);
					const result = rendered.map((line) => `${pad}${line}`);
					// Append ANSI reset to prevent style bleed into subsequent sections
					if (result.length > 0) {
						result[result.length - 1] += "\x1b[0m";
					}
					return result;
				}

				// Editor for "Type something" option
				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				// Helpers
				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function submit(cancelled: boolean) {
					done({ questions, answers: Array.from(answers.values()), cancelled });
				}

				function currentQuestion(): Question | undefined {
					return questions[currentTab];
				}

				function currentOptions(): RenderOption[] {
					const q = currentQuestion();
					if (!q) return [];
					const opts: RenderOption[] = [...q.options];
					if (q.allowOther) {
						opts.push({ value: "__other__", label: "Type something.", isOther: true });
					}
					return opts;
				}

				function allAnswered(): boolean {
					return questions.every((q) => answers.has(q.id));
				}

				function advanceAfterAnswer() {
					if (!isMulti) {
						submit(false);
						return;
					}
					if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = questions.length; // Submit tab
					}
					optionIndex = 0;
					refresh();
				}

				function saveAnswer(
					questionId: string,
					value: string,
					label: string,
					wasCustom: boolean,
					index?: number,
				) {
					answers.set(questionId, { id: questionId, value, label, wasCustom, index });
				}

				// External editor support
				function openExternalEditor() {
					const editorCmd = process.env.VISUAL || process.env.EDITOR;
					if (!editorCmd) return;

					const currentText = editor.getText();
					const tmpFile = path.join(os.tmpdir(), `pi-questionnaire-editor-${Date.now()}.md`);
					try {
						fs.writeFileSync(tmpFile, currentText, "utf-8");
						tui.stop();
						const [cmd, ...args] = editorCmd.split(" ");
						const result = spawnSync(cmd, [...args, tmpFile], {
							stdio: "inherit",
							shell: process.platform === "win32",
						});
						if (result.status === 0) {
							const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
							editor.setText(newContent);
						}
					} finally {
						try {
							fs.unlinkSync(tmpFile);
						} catch {
							// Ignore cleanup errors
						}
						tui.start();
						refresh();
						tui.requestRender(true);
					}
				}

				// Editor submit callback
				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;
					const trimmed = value.trim() || "(no response)";
					saveAnswer(inputQuestionId, trimmed, trimmed, true);
					inputMode = false;
					inputQuestionId = null;
					editor.setText("");
					advanceAfterAnswer();
				};

				function handleInput(data: string) {
					// Input mode: route to editor
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							inputMode = false;
							inputQuestionId = null;
							editor.setText("");
							refresh();
							return;
						}
						// External editor (Ctrl+G)
						if (kb.matches(data, "app.editor.external")) {
							openExternalEditor();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const q = currentQuestion();
					const opts = currentOptions();

					// Tab navigation (multi-question only)
					if (isMulti) {
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							optionIndex = 0;
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							optionIndex = 0;
							refresh();
							return;
						}
					}

					// Submit tab
					if (currentTab === questions.length) {
						if (matchesKey(data, Key.enter) && allAnswered()) {
							submit(false);
						} else if (matchesKey(data, Key.escape)) {
							submit(true);
						}
						return;
					}

					// Option navigation
					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(opts.length - 1, optionIndex + 1);
						refresh();
						return;
					}

					// Select option
					if (matchesKey(data, Key.enter) && q) {
						const opt = opts[optionIndex];
						if (opt.isOther) {
							inputMode = true;
							inputQuestionId = q.id;
							editor.setText("");
							refresh();
							return;
						}
						saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
						advanceAfterAnswer();
						return;
					}

					// Cancel
					if (matchesKey(data, Key.escape)) {
						submit(true);
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;

					const lines: string[] = [];
					const q = currentQuestion();
					const opts = currentOptions();

					// Helper to add truncated line
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					add(theme.fg("accent", "─".repeat(width)));

					// Top-level context (always visible when provided)
					if (topContext) {
						add(theme.fg("dim", " CONTEXT"));
						for (const line of renderContextMarkdown(topContext, width, 1)) {
							lines.push(line);
						}
						lines.push("");
					}

					// Tab bar (multi-question only)
					if (isMulti) {
						const tabs: string[] = ["← "];
						for (let i = 0; i < questions.length; i++) {
							const isActive = i === currentTab;
							const isAnswered = answers.has(questions[i].id);
							const lbl = questions[i].label;
							const box = isAnswered ? "■" : "□";
							const color = isAnswered ? "success" : "muted";
							const text = ` ${box} ${lbl} `;
							const styled = isActive
								? theme.bg("selectedBg", theme.fg("text", text))
								: theme.fg(color, text);
							tabs.push(`${styled} `);
						}
						const canSubmit = allAnswered();
						const isSubmitTab = currentTab === questions.length;
						const submitText = " ✓ Submit ";
						const submitStyled = isSubmitTab
							? theme.bg("selectedBg", theme.fg("text", submitText))
							: theme.fg(canSubmit ? "success" : "dim", submitText);
						tabs.push(`${submitStyled} →`);
						add(` ${tabs.join("")}`);
						lines.push("");
					}

					// Helper to render options list
					function renderOptions() {
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const selected = i === optionIndex;
							const isOther = opt.isOther === true;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const color = selected ? "accent" : "text";
							// Mark "Type something" differently when in input mode
							if (isOther && inputMode) {
								add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`));
							} else {
								add(prefix + theme.fg(color, `${i + 1}. ${opt.label}`));
							}
							if (opt.description) {
								add(`     ${theme.fg("muted", opt.description)}`);
							}
						}
					}

					// Content
					if (inputMode && q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						// Per-question context in input mode too
						if (q.context) {
							for (const line of renderContextMarkdown(q.context, width, 3)) {
								lines.push(line);
							}
							lines.push("");
						}
						// Show options for reference
						renderOptions();
						lines.push("");
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(width - 2)) {
							add(` ${line}`);
						}
						lines.push("");
						add(
							theme.fg(
								"dim",
								" Enter to submit • Esc to cancel" +
									(hasExternalEditor ? " • Ctrl+G external editor" : ""),
							),
						);
					} else if (currentTab === questions.length) {
						add(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						for (const question of questions) {
							const answer = answers.get(question.id);
							if (answer) {
								const prefix = answer.wasCustom ? "(wrote) " : "";
								add(
									`${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", prefix + answer.label)}`,
								);
							}
						}
						lines.push("");
						if (allAnswered()) {
							add(theme.fg("success", " Press Enter to submit"));
						} else {
							const missing = questions
								.filter((q) => !answers.has(q.id))
								.map((q) => q.label)
								.join(", ");
							add(theme.fg("warning", ` Unanswered: ${missing}`));
						}
					} else if (q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						// Per-question context (only for active question)
						if (q.context) {
							for (const line of renderContextMarkdown(q.context, width, 3)) {
								lines.push(line);
							}
							lines.push("");
						}
						renderOptions();
					}

					lines.push("");
					if (!inputMode) {
						const help = isMulti
							? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
							: " ↑↓ navigate • Enter select • Esc cancel";
						add(theme.fg("dim", help));
					}
					add(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
					details: result,
				};
			}

			const answerLines = result.answers.map((a) => {
				const qLabel = questions.find((q) => q.id === a.id)?.label || a.id;
				if (a.wasCustom) {
					return `${qLabel}: user wrote: ${a.label}`;
				}
				return `${qLabel}: user selected: ${a.index}. ${a.label}`;
			});

			return {
				content: [{ type: "text", text: answerLines.join("\n") }],
				details: result,
			};
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

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((a) => {
				if (a.wasCustom) {
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${theme.fg("muted", "(wrote) ")}${a.label}`;
				}
				const display = a.index ? `${a.index}. ${a.label}` : a.label;
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${display}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
