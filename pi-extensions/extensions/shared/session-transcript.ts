import { z } from "zod";

type ParseOptions = {
	onDebug?: (message: string) => void;
};

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

		if (baseEntry.data.type !== "message") continue;

		const parsedMessageEntry = branchMessageEntrySchema.safeParse(rawEntry);
		if (!parsedMessageEntry.success) {
			emitDebug(
				options,
				`branch[${index}]: malformed message entry (${formatZodError(parsedMessageEntry.error)}) value=${previewValue(rawEntry)}`,
			);
			continue;
		}

		const { role, content } = parsedMessageEntry.data.message;
		if (role !== "user" && role !== "assistant") continue;

		const text = extractTextPartsFromContent(
			content,
			`branch[${index}].message.content`,
			knownSessionNonTextBlockTypes,
			options,
		)
			.join("\n")
			.trim();
		if (!text) continue;

		sections.push(`# ${role === "user" ? "User" : "Assistant"}\n\n${text}`);
	}

	return sections.join("\n\n").trim();
}
