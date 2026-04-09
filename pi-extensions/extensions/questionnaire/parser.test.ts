import { describe, expect, it } from "vitest";
import {
	addValidationBanner,
	isExplicitStop,
	normalizeQuestions,
	parseAnswers,
	renderQuestionnaireMarkdown,
	stripValidationBanner,
} from "./parser.js";

const questions = normalizeQuestions([
	{
		id: "stack",
		prompt: "Pick a stack.",
		options: [
			{ value: "ts", label: "TypeScript" },
			{ value: "py", label: "Python" },
		],
	},
	{
		id: "notes",
		label: "Notes",
		prompt: "Anything else?",
		context: "This context intentionally contains a markdown rule.\n---\nStill same question.",
		options: [{ value: "none", label: "No extra notes" }],
	},
]);

describe("questionnaire parser", () => {
	it("renders verbose option details outside the user_response block", () => {
		const rendered = renderQuestionnaireMarkdown(
			undefined,
			[
				normalizeQuestions([
					{
						id: "format",
						prompt: "Which format do you prefer?",
						options: [
							{
								value: "a",
								label: "Option A: Structured table per extension",
								description:
									"Each extension gets a summary table.\n\n- compact\n- scannable\n\n```ts\ntype Example = string;\n```",
							},
						],
					},
				])[0],
			],
			"/tmp/pi-questionnaire/session-tldr.md",
		);

		expect(rendered).toContain("- Session TL;DR/transcript: /tmp/pi-questionnaire/session-tldr.md");
		expect(rendered).toContain("### Options:");
		expect(rendered).toContain("#### 1. Option A: Structured table per extension");
		expect(rendered).toContain("```ts\ntype Example = string;\n```");
		expect(rendered).toContain("### Answer:");
		expect(rendered).toContain(
			"<user_response>\n- [ ] 1. Option A: Structured table per extension\n- [ ] 2. Other",
		);
	});

	it("parses predefined and custom answers from rendered markdown", () => {
		const markdown = renderQuestionnaireMarkdown("Top context", questions)
			.replace("- [ ] 2. Python", "- [x] 2. Python")
			.replace(/- \[ \] 2\. Other(?![\s\S]*- \[ \] 2\. Other)/, "- [x] 2. Other")
			.replace(/```text\n\n```(?![\s\S]*```text\n\n```)/, "```text\nUse pnpm + turborepo\n```");

		const result = parseAnswers(markdown, questions);

		expect(result.errors).toEqual([]);
		expect(result.answers).toEqual([
			{
				id: "stack",
				value: "py",
				label: "Python",
				wasCustom: false,
				index: 2,
			},
			{
				id: "notes",
				value: "Use pnpm + turborepo",
				label: "Use pnpm + turborepo",
				wasCustom: true,
			},
		]);
	});

	it("does not break when question context contains --- separators", () => {
		const markdown = renderQuestionnaireMarkdown(undefined, questions).replace(
			"- [ ] 1. TypeScript",
			"- [x] 1. TypeScript",
		);

		const result = parseAnswers(markdown, [questions[0]]);

		expect(result.errors).toEqual([]);
		expect(result.answers[0]).toMatchObject({
			id: "stack",
			value: "ts",
			index: 1,
		});
	});

	it("returns validation errors for invalid selections", () => {
		const markdown = renderQuestionnaireMarkdown(undefined, questions)
			.replace("- [ ] 1. TypeScript", "- [x] 1. TypeScript")
			.replace("- [ ] 2. Python", "- [x] 2. Python");

		const result = parseAnswers(markdown, [questions[0]]);

		expect(result.answers).toEqual([]);
		expect(result.errors).toEqual([
			{
				questionId: "stack",
				questionLabel: "Q1",
				message: "select exactly one option (multiple selected)",
			},
		]);
	});

	it("requires custom text when Other is selected", () => {
		const markdown = renderQuestionnaireMarkdown(undefined, [questions[1]]).replace(
			"- [ ] 2. Other",
			"- [x] 2. Other",
		);

		const result = parseAnswers(markdown, [questions[1]]);

		expect(result.answers).toEqual([]);
		expect(result.errors).toEqual([
			{
				questionId: "notes",
				questionLabel: "Notes",
				message: "selected Other but custom response text is empty",
			},
		]);
	});

	it("treats an empty buffer as an explicit stop", () => {
		expect(isExplicitStop("")).toBe(true);
		expect(isExplicitStop(" \n\t ")).toBe(true);
		expect(isExplicitStop("# Questionnaire")).toBe(false);
	});

	it("accepts Other for every question", () => {
		const markdown = renderQuestionnaireMarkdown(undefined, [questions[0]])
			.replace("- [ ] 3. Other", "- [x] 3. Other")
			.replace("```text\n\n```", "```text\nSomething custom\n```");

		const result = parseAnswers(markdown, [questions[0]]);

		expect(result.errors).toEqual([]);
		expect(result.answers).toEqual([
			{
				id: "stack",
				value: "Something custom",
				label: "Something custom",
				wasCustom: true,
			},
		]);
	});

	it("replaces existing validation banners instead of stacking them", () => {
		const base = renderQuestionnaireMarkdown(undefined, [questions[0]]);
		const first = addValidationBanner(base, [
			{ questionId: "stack", questionLabel: "Q1", message: "first" },
		]);
		const second = addValidationBanner(first, [
			{ questionId: "stack", questionLabel: "Q1", message: "second" },
		]);

		expect(second).toContain("second");
		expect(second).not.toContain("first");
		expect(stripValidationBanner(second)).toBe(base.trimStart());
	});
});
