import { describe, expect, it } from "vitest";

import readExtension from "./read.js";

function renderRead(content: unknown[], { isError = false, isPartial = false } = {}) {
	let tool: any;
	readExtension({
		registerTool(definition: any) {
			tool = definition;
		},
	} as any);

	const theme = {
		fg: (name: string, value: string) => `<${name}>${value}</${name}>`,
	};
	return tool
		.renderResult({ content }, { isPartial }, theme, { isError })
		.render(120)
		.map((line: string) => line.trimEnd())
		.join("\n");
}

describe("read tool renderResult", () => {
	it.each([
		["x", "1", "success"],
		["x".repeat(1996), "499", "success"],
		["x".repeat(2000), "500", "warning"],
		["x".repeat(3996), "999", "warning"],
		["x".repeat(4000), "1000", "error"],
		["x".repeat(6000), "2K", "error"],
	])("shows Bash-style tokens without file contents (case %#)", (text, tokens, color) => {
		expect(renderRead([{ type: "text", text }])).toBe(
			`<dim>[</dim><${color}>${tokens} tokens</${color}><dim>]</dim>`,
		);
	});

	it("counts all text blocks but not image data", () => {
		expect(
			renderRead([
				{ type: "text", text: "abcd" },
				{ type: "image", data: "a".repeat(100), mimeType: "image/png" },
				{ type: "text", text: "efgh" },
			]),
		).toContain("<success>3 tokens</success>");
	});

	it("shows zero text tokens for an image-only result", () => {
		expect(renderRead([{ type: "image", data: "abcd", mimeType: "image/png" }])).toContain(
			"<success>0 tokens</success>",
		);
	});

	it("does not show counts for partial results", () => {
		expect(renderRead([{ type: "text", text: "abcd" }], { isPartial: true })).toBe("");
	});

	it("preserves simplified error rendering without a token count", () => {
		expect(
			renderRead([{ type: "text", text: "ENOENT: no such file or directory" }], { isError: true }),
		).toBe("<error>No such path</error>");
	});
});
