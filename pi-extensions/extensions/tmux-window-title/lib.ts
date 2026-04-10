import type { Model } from "@mariozechner/pi-ai";
import { z } from "zod";

type ModelLike = Pick<Model<any>, "provider" | "id" | "reasoning">;

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ParseOptions = {
	onDebug?: (message: string) => void;
};

export type PreferredWindowTitleModel<T extends ModelLike = ModelLike> = {
	model: T;
	thinkingLevel?: ThinkingLevel;
};

const PREFERRED_SMALL_MODELS = [
	{ provider: "openai", id: "gpt-5.4-nano", thinkingLevel: "off" },
	{ provider: "openai-codex", id: "gpt-5.4-mini", thinkingLevel: "off" },
] as const;

const knownSessionNonTextBlockTypes = new Set(["thinking", "toolCall", "image"]);

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
		options.onDebug?.(
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
			options.onDebug?.(
				`${contextLabel}[${index}]: invalid content block (${formatZodError(parsedTypedBlock.error)}) value=${previewValue(part)}`,
			);
			continue;
		}

		const blockType = parsedTypedBlock.data.type;
		if (blockType === "text") {
			options.onDebug?.(
				`${contextLabel}[${index}]: malformed text block (${formatZodError(parsedTextBlock.error)}) value=${previewValue(part)}`,
			);
			continue;
		}

		if (!nonTextTypes.has(blockType)) {
			options.onDebug?.(
				`${contextLabel}[${index}]: unexpected content block type "${blockType}" value=${previewValue(part)}`,
			);
		}
	}

	return textParts;
}

export function formatModelRef(model: Pick<ModelLike, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function parseTmuxWindowId(rawOutput: string): string | undefined {
	const candidate = rawOutput.trim().split(/\s+/)[0];
	return /^@\d+$/.test(candidate) ? candidate : undefined;
}

export function extractFirstUserMessage(
	entries: readonly unknown[],
	options: ParseOptions = {},
): string {
	const parsedEntries = unknownArraySchema.safeParse(entries);
	if (!parsedEntries.success) {
		options.onDebug?.(`branch entries: ${formatZodError(parsedEntries.error)}`);
		return "";
	}

	for (const [index, rawEntry] of parsedEntries.data.entries()) {
		const baseEntry = branchEntryBaseSchema.safeParse(rawEntry);
		if (!baseEntry.success) {
			options.onDebug?.(
				`branch[${index}]: invalid entry (${formatZodError(baseEntry.error)}) value=${previewValue(rawEntry)}`,
			);
			continue;
		}

		if (baseEntry.data.type !== "message") continue;

		const parsedMessageEntry = branchMessageEntrySchema.safeParse(rawEntry);
		if (!parsedMessageEntry.success) {
			options.onDebug?.(
				`branch[${index}]: malformed message entry (${formatZodError(parsedMessageEntry.error)}) value=${previewValue(rawEntry)}`,
			);
			continue;
		}

		const { role, content } = parsedMessageEntry.data.message;
		if (role !== "user") continue;

		const text = extractTextPartsFromContent(
			content,
			`branch[${index}].message.content`,
			knownSessionNonTextBlockTypes,
			options,
		)
			.join("\n")
			.trim();
		if (text) return text;
	}

	return "";
}

export function pickWindowTitleModel<T extends ModelLike>(
	available: readonly T[],
): PreferredWindowTitleModel<T> | undefined {
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

export function buildWindowTitleSystemPrompt(): string {
	return [
		"You create ultra-short tmux window titles for Pi coding-agent sessions.",
		"Read the user's request and reply with a terse 1 to 4 word label for the task.",
		"Return only the label text.",
		"Do not add explanations, quotes, markdown, numbering, prefixes, or suffixes.",
		"Prefer concrete nouns over generic verbs when possible.",
		"Do not call tools.",
	].join("\n");
}

export function buildWindowTitlePrompt(firstUserMessage: string): string {
	return [
		"Create a very short tmux window title for this request.",
		"Keep it to 1 to 4 words.",
		"Output only the title text.",
		"",
		"<request>",
		firstUserMessage,
		"</request>",
	].join("\n");
}

export function normalizeWindowTitle(
	rawTitle: string,
	options: { fallback?: string; maxWords?: number } = {},
): string {
	const fallback = options.fallback?.trim() || "pi";
	const maxWords = Math.max(1, options.maxWords ?? 4);

	const sanitized = rawTitle
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`+/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/^[\s>*#-]+/gm, " ")
		.replace(/[–—_/:]+/g, " ");

	const words = (sanitized.match(/[\p{L}\p{N}]+/gu) ?? [])
		.map((word) => word.toLowerCase())
		.filter(Boolean)
		.slice(0, maxWords);

	return words.length > 0 ? words.join("-") : fallback;
}
