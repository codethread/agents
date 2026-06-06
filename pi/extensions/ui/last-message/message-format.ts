import { z } from "zod";

export const RESPONSE_SEPARATOR_COMMENT = "<!-- pi-last-message-response-below -->";

const unknownArraySchema = z.array(z.unknown());
const branchEntryBaseSchema = z.object({ type: z.string() }).passthrough();
const branchMessageEntrySchema = z
	.object({
		type: z.literal("message"),
		message: z.object({
			role: z.string(),
			content: z.unknown(),
		}),
	})
	.passthrough();
const textContentBlockSchema = z
	.object({ type: z.literal("text"), text: z.string() })
	.passthrough();
const contentBlockWithTypeSchema = z.object({ type: z.string() }).passthrough();

const knownNonTextTypes = new Set(["thinking", "toolCall", "image"]);

type MessageRole = "user" | "assistant";

type TranscriptMessage = {
	role: MessageRole;
	text: string;
};

function extractTextParts(content: unknown): string[] {
	if (typeof content === "string") {
		const text = content.trim();
		return text ? [text] : [];
	}

	const parsed = unknownArraySchema.safeParse(content);
	if (!parsed.success) return [];

	const parts: string[] = [];
	for (const part of parsed.data) {
		const textBlock = textContentBlockSchema.safeParse(part);
		if (textBlock.success) {
			const text = textBlock.data.text.trim();
			if (text) parts.push(text);
			continue;
		}

		const typedBlock = contentBlockWithTypeSchema.safeParse(part);
		if (typedBlock.success && knownNonTextTypes.has(typedBlock.data.type)) continue;
	}
	return parts;
}

export function extractConversationMessages(entries: readonly unknown[]): TranscriptMessage[] {
	const parsedEntries = unknownArraySchema.safeParse(entries);
	if (!parsedEntries.success) return [];

	const messages: TranscriptMessage[] = [];
	for (const rawEntry of parsedEntries.data) {
		const baseEntry = branchEntryBaseSchema.safeParse(rawEntry);
		if (!baseEntry.success || baseEntry.data.type !== "message") continue;

		const messageEntry = branchMessageEntrySchema.safeParse(rawEntry);
		if (!messageEntry.success) continue;

		const role = messageEntry.data.message.role;
		if (role !== "user" && role !== "assistant") continue;

		const text = extractTextParts(messageEntry.data.message.content).join("\n").trim();
		if (text) messages.push({ role, text });
	}
	return messages;
}

export function formatLastAssistantMessage(entries: readonly unknown[]): string {
	const messages = extractConversationMessages(entries);
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message.text;
	}
	return "";
}

export function formatAllConversationMessages(entries: readonly unknown[]): string {
	return extractConversationMessages(entries)
		.map((message) => `# ${message.role === "user" ? "User" : "Assistant"}\n\n${message.text}`)
		.join("\n\n---\n\n")
		.trim();
}

export function appendResponseSeparator(body: string): string {
	return `${body.trimEnd()}\n\n${RESPONSE_SEPARATOR_COMMENT}\n`;
}

export function extractResponseAfterSeparator(editedBody: string): string {
	const separatorIndex = editedBody.indexOf(RESPONSE_SEPARATOR_COMMENT);
	if (separatorIndex === -1) return "";
	return editedBody.slice(separatorIndex + RESPONSE_SEPARATOR_COMMENT.length).trim();
}
