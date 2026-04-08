import type { Model } from "@mariozechner/pi-ai";
import { z } from "zod";

type ModelLike = Pick<Model<any>, "provider" | "id" | "reasoning">;

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type PreferredTldrModel<T extends ModelLike = ModelLike> = {
	model: T;
	thinkingLevel?: ThinkingLevel;
};

type ParseOptions = {
	onDebug?: (message: string) => void;
};

export type ResponseSummaryParseResult = {
	summary: string;
	stopReason?: string;
	errorMessage?: string;
	debug: string[];
};

const PREFERRED_SMALL_MODELS = [
	{ provider: "openai", id: "gpt-5.4-nano", thinkingLevel: "low" },
	{ provider: "openai-codex", id: "gpt-5.4-mini", thinkingLevel: "low" },
] as const;

const knownSessionNonTextBlockTypes = new Set(["thinking", "toolCall", "image"]);
const knownResponseNonTextBlockTypes = new Set(["thinking", "toolCall"]);

const unknownArraySchema = z.array(z.unknown());

const branchEntryBaseSchema = z
	.object({
		type: z.string(),
	})
	.passthrough();

const branchMessageEntrySchema = z
	.object({
		type: z.literal("message"),
		message: z.object({
			role: z.string(),
			content: z.unknown(),
		}),
	})
	.passthrough();

const contentBlockWithTypeSchema = z
	.object({
		type: z.string(),
	})
	.passthrough();

const textContentBlockSchema = z
	.object({
		type: z.literal("text"),
		text: z.string(),
	})
	.passthrough();

const assistantResponseSchema = z
	.object({
		role: z.literal("assistant").optional(),
		content: z.unknown(),
		stopReason: z.unknown().optional(),
		errorMessage: z.unknown().optional(),
	})
	.passthrough();

const stopReasonSchema = z.enum(["stop", "length", "toolUse", "error", "aborted"]);

function emitDebug(options: ParseOptions, message: string) {
	options.onDebug?.(message);
}

function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

function previewValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || value === null)
		return String(value);
	if (typeof value === "undefined") return "undefined";

	try {
		const serialized = JSON.stringify(value);
		if (!serialized) return String(value);
		return serialized.length > 240 ? `${serialized.slice(0, 237)}...` : serialized;
	} catch {
		return String(value);
	}
}

function extractTextPartsFromContent(
	content: unknown,
	contextLabel: string,
	nonTextTypes: ReadonlySet<string>,
	options: ParseOptions,
): string[] {
	if (typeof content === "string") {
		const text = content.trim();
		return text ? [text] : [];
	}

	const parsedContentArray = unknownArraySchema.safeParse(content);
	if (!parsedContentArray.success) {
		emitDebug(
			options,
			`${contextLabel}: expected string or content[] (${formatZodError(parsedContentArray.error)})`,
		);
		return [];
	}

	const textParts: string[] = [];
	for (const [index, part] of parsedContentArray.data.entries()) {
		const parsedTextBlock = textContentBlockSchema.safeParse(part);
		if (parsedTextBlock.success) {
			const text = parsedTextBlock.data.text.trim();
			if (text) textParts.push(text);
			continue;
		}

		const parsedTypedBlock = contentBlockWithTypeSchema.safeParse(part);
		if (!parsedTypedBlock.success) {
			emitDebug(
				options,
				`${contextLabel}[${index}]: invalid content block (${formatZodError(parsedTypedBlock.error)}) value=${previewValue(part)}`,
			);
			continue;
		}

		const blockType = parsedTypedBlock.data.type;
		if (blockType === "text") {
			emitDebug(
				options,
				`${contextLabel}[${index}]: malformed text block (${formatZodError(parsedTextBlock.error)}) value=${previewValue(part)}`,
			);
			continue;
		}

		if (!nonTextTypes.has(blockType)) {
			emitDebug(
				options,
				`${contextLabel}[${index}]: unexpected content block type "${blockType}" value=${previewValue(part)}`,
			);
		}
	}

	return textParts;
}

export function formatModelRef(model: Pick<ModelLike, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function buildConversationTranscript(
	entries: readonly unknown[],
	options: ParseOptions = {},
): string {
	const sections: string[] = [];

	const parsedEntries = unknownArraySchema.safeParse(entries);
	if (!parsedEntries.success) {
		emitDebug(options, `branch entries: ${formatZodError(parsedEntries.error)}`);
		return "";
	}

	for (const [index, rawEntry] of parsedEntries.data.entries()) {
		const baseEntry = branchEntryBaseSchema.safeParse(rawEntry);
		if (!baseEntry.success) {
			emitDebug(
				options,
				`branch[${index}]: invalid entry (${formatZodError(baseEntry.error)}) value=${previewValue(rawEntry)}`,
			);
			continue;
		}

		if (baseEntry.data.type !== "message") {
			continue;
		}

		const parsedMessageEntry = branchMessageEntrySchema.safeParse(rawEntry);
		if (!parsedMessageEntry.success) {
			emitDebug(
				options,
				`branch[${index}]: malformed message entry (${formatZodError(parsedMessageEntry.error)}) value=${previewValue(rawEntry)}`,
			);
			continue;
		}

		const { role, content } = parsedMessageEntry.data.message;
		if (role !== "user" && role !== "assistant") {
			continue;
		}

		const text = extractTextPartsFromContent(
			content,
			`branch[${index}].message.content`,
			knownSessionNonTextBlockTypes,
			options,
		)
			.join("\n")
			.trim();
		if (!text) continue;

		sections.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}

	return sections.join("\n\n").trim();
}

export function extractSummaryFromResponse(response: unknown): ResponseSummaryParseResult {
	const debug: string[] = [];
	const parsedResponse = assistantResponseSchema.safeParse(response);
	if (!parsedResponse.success) {
		debug.push(
			`assistant response: ${formatZodError(parsedResponse.error)} value=${previewValue(response)}`,
		);
		return { summary: "", debug };
	}

	let stopReason: string | undefined;
	if (parsedResponse.data.stopReason !== undefined) {
		const parsedStopReason = stopReasonSchema.safeParse(parsedResponse.data.stopReason);
		if (parsedStopReason.success) {
			stopReason = parsedStopReason.data;
		} else if (typeof parsedResponse.data.stopReason === "string") {
			stopReason = parsedResponse.data.stopReason;
			debug.push(
				`assistant.stopReason: unexpected value "${parsedResponse.data.stopReason}"; expected one of ${stopReasonSchema.options.join(", ")}`,
			);
		} else {
			debug.push(
				`assistant.stopReason: expected string value, got ${previewValue(parsedResponse.data.stopReason)}`,
			);
		}
	}

	let errorMessage: string | undefined;
	if (parsedResponse.data.errorMessage !== undefined) {
		const parsedErrorMessage = z.string().safeParse(parsedResponse.data.errorMessage);
		if (parsedErrorMessage.success) {
			errorMessage = parsedErrorMessage.data;
		} else {
			debug.push(
				`assistant.errorMessage: expected string value, got ${previewValue(parsedResponse.data.errorMessage)}`,
			);
		}
	}

	const summary = extractTextPartsFromContent(
		parsedResponse.data.content,
		"assistant.content",
		knownResponseNonTextBlockTypes,
		{
			onDebug: (message: string) => debug.push(message),
		},
	)
		.join("\n")
		.trim();

	return {
		summary,
		stopReason,
		errorMessage,
		debug,
	};
}

export function pickTldrModel<T extends ModelLike>(
	available: readonly T[],
): PreferredTldrModel<T> | undefined {
	for (const preferred of PREFERRED_SMALL_MODELS) {
		const match = available.find(
			(model) => model.provider === preferred.provider && model.id === preferred.id,
		);
		if (match) {
			return {
				model: match,
				thinkingLevel: preferred.thinkingLevel,
			};
		}
	}

	return undefined;
}

export function buildTldrPrompt(transcript: string): string {
	return [
		"You are writing a short catch-up summary for the human user of a Pi coding-agent session.",
		"Try to keep the entire response under 50 lines",
		"Focus on the original goal, what has been completed, what is still in progress, important decisions or constraints, and the next likely step.",
		"Ignore tool-call mechanics and hidden reasoning unless they materially change the status.",
		"Be concise and practical.",
		"Use this structure:",
		"## Goal",
		"## Status",
		"## Important context",
		"## Next",
		"If the transcript is incomplete or ambiguous, say so briefly.",
		"",
		"<session>",
		transcript,
		"</session>",
	].join("\n");
}
