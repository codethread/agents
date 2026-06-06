import { describe, expect, it } from "vitest";
import {
	appendResponseSeparator,
	extractResponseAfterSeparator,
	formatAllConversationMessages,
	formatLastAssistantMessage,
	RESPONSE_SEPARATOR_COMMENT,
} from "./message-format.js";

const branch = [
	{
		type: "message",
		message: { role: "user", content: [{ type: "text", text: "First question" }] },
	},
	{
		type: "message",
		message: {
			role: "assistant",
			content: [
				{ type: "thinking", text: "hidden" },
				{ type: "text", text: "First answer" },
				{ type: "toolCall", id: "call-1" },
			],
		},
	},
	{
		type: "toolResult",
		message: { role: "tool", content: [{ type: "text", text: "tool output" }] },
	},
	{
		type: "message",
		message: { role: "user", content: "Follow up" },
	},
	{
		type: "message",
		message: { role: "assistant", content: [{ type: "text", text: "Final answer" }] },
	},
];

describe("last-message formatting", () => {
	it("formats the last assistant text only", () => {
		expect(formatLastAssistantMessage(branch)).toBe("Final answer");
	});

	it("formats all user and assistant messages separated by markdown rules", () => {
		expect(formatAllConversationMessages(branch)).toBe(
			[
				"# User\n\nFirst question",
				"# Assistant\n\nFirst answer",
				"# User\n\nFollow up",
				"# Assistant\n\nFinal answer",
			].join("\n\n---\n\n"),
		);
	});

	it("extracts saved response text after the separator comment", () => {
		const body = appendResponseSeparator("Long answer") + "\n\nDraft reply\n";

		expect(body).toContain(RESPONSE_SEPARATOR_COMMENT);
		expect(extractResponseAfterSeparator(body)).toBe("Draft reply");
	});
});
