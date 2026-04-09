export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

export interface QuestionInput {
	id: string;
	label?: string;
	prompt: string;
	context?: string;
	options: QuestionOption[];
}

export interface Question {
	id: string;
	label: string;
	prompt: string;
	context?: string;
	options: QuestionOption[];
}

export interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

export interface ParseError {
	questionId: string;
	questionLabel: string;
	message: string;
}

export interface ParseResult {
	answers: Answer[];
	errors: ParseError[];
}

export const VALIDATION_START = "<!-- questionnaire-errors:start -->";
export const VALIDATION_END = "<!-- questionnaire-errors:end -->";
const VALIDATION_BANNER_RE = new RegExp(
	`${escapeRegex(VALIDATION_START)}[\\s\\S]*?${escapeRegex(VALIDATION_END)}\\s*`,
	"g",
);

export function normalizeQuestions(rawQuestions: QuestionInput[]): Question[] {
	return rawQuestions.map((question, index) => ({
		...question,
		label: question.label || `Q${index + 1}`,
	}));
}

export function renderQuestionnaireMarkdown(
	topContext: string | undefined,
	questions: Question[],
	sessionTldrPath?: string,
): string {
	const lines: string[] = [];

	lines.push("# Questionnaire");
	lines.push("");
	lines.push("Complete each question by editing the `<user_response>` block in place:");
	lines.push("- Check exactly one option per question by changing `[ ]` to `[x]`.");
	lines.push("- If you check `Other`, provide custom text inside the fenced block.");
	lines.push("- Save and exit the editor to submit.");
	lines.push("- Exit the editor with a non-zero status to cancel.");
	if (sessionTldrPath) {
		lines.push(`- Session TL;DR/transcript: ${sessionTldrPath}`);
	}

	if (topContext) {
		lines.push("");
		lines.push("## Context");
		lines.push("");
		lines.push(topContext);
	}

	for (const [index, question] of questions.entries()) {
		const defaultLabel = `Q${index + 1}`;
		const heading =
			question.label === defaultLabel ? question.label : `${defaultLabel} — ${question.label}`;

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
		lines.push("### Options:");
		for (const [optionIndex, option] of question.options.entries()) {
			lines.push("");
			lines.push(`#### ${optionIndex + 1}. ${option.label}`);
			if (option.description) {
				lines.push("");
				lines.push(option.description);
			}
		}

		lines.push("");
		lines.push("### Answer:");
		lines.push("");
		lines.push("<user_response>");
		for (const [optionIndex, option] of question.options.entries()) {
			lines.push(`- [ ] ${optionIndex + 1}. ${option.label}`);
		}

		const otherIndex = question.options.length + 1;
		lines.push(`- [ ] ${otherIndex}. Other`);
		lines.push("");
		lines.push("```text");
		lines.push("");
		lines.push("```");
		lines.push("</user_response>");
	}

	lines.push("");
	return lines.join("\n");
}

export function stripValidationBanner(markdown: string): string {
	return markdown.replace(VALIDATION_BANNER_RE, "").trimStart();
}

export function isExplicitStop(markdown: string): boolean {
	return markdown.trim().length === 0;
}

export function addValidationBanner(markdown: string, errors: ParseError[]): string {
	const cleaned = stripValidationBanner(markdown);
	if (errors.length === 0) return cleaned;

	const bannerLines: string[] = [
		VALIDATION_START,
		"## ⚠ Validation errors",
		"",
		"Please fix the items below, then save and exit again:",
		"",
		...errors.map(
			(error) => `- **${error.questionLabel}** (\`${error.questionId}\`): ${error.message}`,
		),
		"",
		"To cancel, exit the editor with a non-zero status.",
		VALIDATION_END,
	];

	return `${bannerLines.join("\n")}\n\n${cleaned}`;
}

export function parseAnswers(markdown: string, questions: Question[]): ParseResult {
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
		const maxIndex = question.options.length + 1;
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

export function extractQuestionSection(
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

	const nextMarker = /<!-- questionnaire-question:[^>]+ -->/g;
	nextMarker.lastIndex = firstMarkerIndex + marker.length;
	const nextMarkerMatch = nextMarker.exec(markdown);
	const sectionEnd = nextMarkerMatch ? nextMarkerMatch.index : markdown.length;
	return { section: markdown.slice(firstMarkerIndex, sectionEnd) };
}

export function extractResponseBlock(
	section: string,
): { responseBlock: string } | { error: string } {
	const matches = Array.from(section.matchAll(/<user_response>([\s\S]*?)<\/user_response>/g));
	if (matches.length === 0) {
		return { error: "missing <user_response> block" };
	}
	if (matches.length > 1) {
		return { error: "multiple <user_response> blocks found" };
	}
	return { responseBlock: matches[0][1] };
}

export function parseSelection(
	responseBlock: string,
): { selectedIndex: number } | { error: string } {
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

export function extractCustomResponse(responseBlock: string): string | null {
	const fenced = responseBlock.match(/```(?:text)?[^\n\r]*\r?\n([\s\S]*?)\r?\n```/m);
	if (!fenced) return null;

	const trimmed = fenced[1].trim();
	return trimmed.length > 0 ? trimmed : null;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
