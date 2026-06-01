import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createWriteTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

const existingFileByToolCall = new Map<string, boolean>();

function lineCount(text: string) {
	if (text.length === 0) return 0;
	const lines = text.split("\n").length;
	return text.endsWith("\n") ? lines - 1 : lines;
}

function firstLine(text: string) {
	if (text.length === 0) return "(empty file)";
	return text.split("\n", 1)[0] || "(empty first line)";
}

function absolutePath(cwd: string, path: string) {
	return resolve(cwd, path);
}

export default function (pi: ExtensionAPI) {
	const builtinWrite = createWriteTool(process.cwd());

	pi.registerTool({
		...builtinWrite,
		name: "write",
		promptSnippet: "Write content to a file",
		promptGuidelines: ["Use write only for new files or complete rewrites."],

		async execute(toolCallId, params, signal, onUpdate) {
			existingFileByToolCall.set(toolCallId, existsSync(absolutePath(process.cwd(), params.path)));
			return builtinWrite.execute(toolCallId, params, signal, onUpdate);
		},

		renderCall(args, theme, context) {
			const path = (args.path as string | undefined) ?? "(unknown)";
			const content = (args.content as string | undefined) ?? "";

			if (context.argsComplete && path !== "(unknown)" && !existingFileByToolCall.has(context.toolCallId)) {
				existingFileByToolCall.set(context.toolCallId, existsSync(absolutePath(context.cwd, path)));
			}

			const existed = existingFileByToolCall.get(context.toolCallId) ?? false;
			const pathColor = existed ? "warning" : "muted";
			const prefix = context.argsComplete ? "" : "...";
			const count = lineCount(content);

			return new Text(
				theme.fg("toolTitle", theme.bold("write ")) +
					theme.fg(pathColor, path) +
					theme.fg("dim", ` (${prefix}${count} lines)`) +
					"\n" +
					theme.fg("toolOutput", firstLine(content)),
				0,
				0,
			);
		},

		renderResult(result, _options, theme, context) {
			if (context.isError) {
				const first = result.content?.find((item) => item.type === "text");
				const rawMessage = first?.type === "text" ? first.text : "write failed";
				return new Text(theme.fg("error", rawMessage.split("\n")[0] || "write failed"), 0, 0);
			}

			return new Container();
		},
	});
}
