import { describe, expect, it } from "vitest";
import { argvForExtensions, parsePiArgs } from "./args.ts";

describe("parsePiArgs", () => {
	it("parses the common pi print-mode invocation", () => {
		const parsed = parsePiArgs([
			"--model",
			"deepseek/deepseek-v4-flash",
			"--thinking",
			"low",
			"--print",
			"ping",
		]);

		expect(parsed.model).toBe("deepseek/deepseek-v4-flash");
		expect(parsed.thinking).toBe("low");
		expect(parsed.messages).toEqual(["ping"]);
		expect(parsed.diagnostics).toEqual([]);
	});

	it("parses inline values for known value, repeatable, and list options", () => {
		const parsed = parsePiArgs([
			"--model=openai/gpt-5.6-terra",
			"--append-system-prompt=one",
			"--tools=read,bash",
			"--exclude-extension=pi-nvim",
		]);

		expect(parsed.model).toBe("openai/gpt-5.6-terra");
		expect(parsed.appendSystemPrompt).toEqual(["one"]);
		expect(parsed.tools).toEqual(["read", "bash"]);
		expect(parsed.excludeExtensions).toEqual(["pi-nvim"]);
		expect(parsed.unknownFlags).toEqual(new Map());
	});

	it("preserves extension flags and values", () => {
		const parsed = parsePiArgs(["--agent", "scout", "--debug-dialogue-capture"]);

		expect(parsed.unknownFlags).toEqual(
			new Map<string, string | true>([
				["agent", "scout"],
				["debug-dialogue-capture", true],
			]),
		);
	});

	it("treats values after -- as positional input", () => {
		const parsed = parsePiArgs(["--", "-literal", "@prompt.md"]);

		expect(parsed.messages).toEqual(["-literal"]);
		expect(parsed.fileArgs).toEqual(["prompt.md"]);
	});

	it("reports missing values at the CLI boundary", () => {
		const parsed = parsePiArgs(["--model"]);

		expect(parsed.diagnostics).toEqual([{ type: "error", message: "--model requires a value" }]);
	});

	it("collects repeatable extension exclusions and rejects empty values", () => {
		const parsed = parsePiArgs(["--exclude-extension", " pi-nvim ", "--exclude-extension", ""]);

		expect(parsed.excludeExtensions).toEqual(["pi-nvim"]);
		expect(parsed.diagnostics).toContainEqual({
			type: "error",
			message: "--exclude-extension requires a non-empty value",
		});
	});
});

describe("argvForExtensions", () => {
	it("keeps request flags but hides print mode from process-exit extensions", () => {
		const argv = argvForExtensions(["--print", "--agent", "scout", "ping"]);

		expect(argv).toContain("--agent");
		expect(argv).not.toContain("--print");
	});

	it("hides pies-only exclusions from extensions but preserves positional values", () => {
		expect(
			argvForExtensions(["--exclude-extension", "pi-nvim", "--", "--exclude-extension", "message"]),
		).toEqual([process.execPath, "pies", "--", "--exclude-extension", "message"]);
	});

	it("hides inline pies-only exclusions from extensions", () => {
		expect(argvForExtensions(["--exclude-extension=pi-nvim", "ping"])).toEqual([
			process.execPath,
			"pies",
			"ping",
		]);
	});
});
