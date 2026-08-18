import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const COMMAND_PREVIEW_LINES = 5;
const ELLIPSIS = " ...";
const WRAP_PREFIX = "  \\ ";
const durationByToolCall = new Map<string, number>();

function formatDuration(ms: number) {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.round(ms / 1000)}s`;
}

function estimateTokens(text: string) {
	// Bash output is usually plain text; four characters per token is a useful
	// rough estimate without tying the extension to a model-specific tokenizer.
	return Math.ceil(text.length / 4);
}

function formatTokenCount(tokens: number) {
	return tokens > 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}

function splitAtOperators(command: string) {
	const parts: Array<{ operator?: "&&" | "||"; text: string }> = [];
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaped = false;
	let start = 0;

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		const next = command[index + 1];

		if (escaped) {
			escaped = false;
			continue;
		}

		if (char === "\\" && !inSingleQuote) {
			escaped = true;
			continue;
		}

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			continue;
		}

		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}

		if (!inSingleQuote && !inDoubleQuote && (char === "&" || char === "|") && next === char) {
			const operator = `${char}${next}` as "&&" | "||";
			parts.push({ text: command.slice(start, index).trimEnd() });
			start = index + 2;
			index += 1;
			parts.push({ operator, text: "" });
		}
	}

	return { parts, tail: command.slice(start).trimStart() };
}

function truncateLineForEllipsis(line: string, width: number) {
	const marked = `${line}${ELLIPSIS}`;
	if (!Number.isFinite(width)) return marked;
	return truncateToWidth(marked, width, ELLIPSIS);
}

function takeWrappedSegment(text: string, available: number) {
	if (visibleWidth(text) <= available) return { segment: text, remaining: "" };

	let segmentEnd = 0;
	let segmentWidth = 0;
	for (const char of text) {
		const charWidth = visibleWidth(char);
		if (segmentWidth + charWidth > available) break;
		segmentEnd += char.length;
		segmentWidth += charWidth;
	}

	const candidate = text.slice(0, segmentEnd);
	const breakIndex = candidate.lastIndexOf(" ");
	if (breakIndex > 0) {
		return {
			segment: text.slice(0, breakIndex),
			remaining: text.slice(breakIndex + 1),
		};
	}

	return {
		segment: text.slice(0, segmentEnd),
		remaining: text.slice(segmentEnd),
	};
}

function wrapLine(line: string, width: number) {
	if (!Number.isFinite(width) || width <= 0 || visibleWidth(line) <= width) return [line];

	const lines: string[] = [];
	let remaining = line;
	let first = true;
	while (remaining.length > 0) {
		const prefix = first ? "" : WRAP_PREFIX;
		const available = Math.max(1, width - visibleWidth(prefix));
		const wrapped = takeWrappedSegment(remaining, available);
		lines.push(`${prefix}${wrapped.segment}`);
		remaining = wrapped.remaining;
		first = false;
	}
	return lines;
}

export function formatBashCommandForDisplay(command: string) {
	const { parts, tail } = splitAtOperators(command);
	if (parts.length === 0) return command;

	const lines: string[] = [];
	let pendingOperator: "&&" | "||" | undefined;
	for (const part of parts) {
		if (part.operator) {
			pendingOperator = part.operator;
			continue;
		}

		if (pendingOperator) {
			lines.push(`  ${pendingOperator} ${part.text.trimStart()}`);
			pendingOperator = undefined;
		} else {
			lines.push(part.text);
		}
	}
	if (pendingOperator) lines.push(`  ${pendingOperator} ${tail}`);
	else lines.push(tail);

	return lines.join("\n");
}

export function formatBashCommandPreview(
	command: string,
	width: number,
	maxLines = COMMAND_PREVIEW_LINES,
) {
	const formatted = formatBashCommandForDisplay(command).split("\n");
	const logicalLines = formatted.map((line, index) => (index === 0 ? `$ ${line}` : line));
	const visualLines = logicalLines.flatMap((line) => wrapLine(line, width));
	if (visualLines.length <= maxLines) return visualLines;

	return [
		...visualLines.slice(0, maxLines - 1),
		truncateLineForEllipsis(visualLines[maxLines - 1] ?? "", width),
	];
}

export function formatBashOutput(output: string) {
	if (!output.startsWith("{")) return output;

	try {
		return JSON.stringify(JSON.parse(output), null, "\t");
	} catch {
		// Shell output may be JSONL or begin with a non-JSON diagnostic. Pretty
		// printing is optional; preserve output the JSON parser cannot consume whole.
		return output;
	}
}

export function formatBashOutputPreview(output: string, width: number) {
	const visualLines = new Text(output, 0, 0).render(width);
	return {
		lines: visualLines.slice(0, COMMAND_PREVIEW_LINES),
		skippedLineCount: Math.max(0, visualLines.length - COMMAND_PREVIEW_LINES),
	};
}

export default function (pi: ExtensionAPI) {
	const builtinBash = createBashTool(process.cwd());

	pi.registerTool({
		...builtinBash,
		name: "bash",
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",

		async execute(toolCallId, params, signal, onUpdate) {
			const startedAt = Date.now();
			try {
				return await builtinBash.execute(toolCallId, params, signal, onUpdate);
			} finally {
				durationByToolCall.set(toolCallId, Date.now() - startedAt);
			}
		},

		renderCall(args, theme, context) {
			const command = args.command ?? "...";
			return {
				invalidate() {},
				render(width: number) {
					const timeoutSuffix =
						args.timeout && Number.isFinite(width) ? ` (timeout: ${args.timeout}s)` : "";
					const previewWidth = timeoutSuffix
						? Math.max(1, width - visibleWidth(timeoutSuffix))
						: width;
					const maxLines = context.expanded ? Number.POSITIVE_INFINITY : COMMAND_PREVIEW_LINES;
					const lines = formatBashCommandPreview(command, previewWidth, maxLines).map(
						(line, index) => {
							if (index === 0 && line.startsWith("$ ")) {
								return theme.fg("toolTitle", theme.bold("$ ")) + theme.fg("accent", line.slice(2));
							}
							return theme.fg("accent", line);
						},
					);
					if (timeoutSuffix && lines.length < maxLines) {
						lines[lines.length - 1] = truncateToWidth(
							`${lines[lines.length - 1] ?? ""}${theme.fg("muted", timeoutSuffix)}`,
							width,
							theme.fg("muted", " ..."),
						);
					}
					return lines.map((line) => truncateToWidth(line, width, theme.fg("muted", " ...")));
				},
			};
		},

		renderResult(result, { isPartial }, theme, context) {
			if (isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

			const duration = durationByToolCall.get(context.toolCallId);
			if (duration === undefined) return new Container();

			const output =
				result.content
					?.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n") ?? "";
			const tokens = formatTokenCount(estimateTokens(output));
			const formattedOutput = formatBashOutput(output);
			const completion = theme.fg(
				"dim",
				`Completed in ${formatDuration(duration)} [${tokens} tokens]`,
			);
			if (context.expanded) {
				const rendered = formattedOutput
					.split("\n")
					.map((line) => theme.fg("toolOutput", line))
					.join("\n");
				return new Text(rendered ? `${rendered}\n${completion}` : completion, 0, 0);
			}

			return {
				invalidate() {},
				render(width: number) {
					const preview = formatBashOutputPreview(formattedOutput, width);
					const lines = preview.lines.map((line) => theme.fg("toolOutput", line));
					if (preview.skippedLineCount > 0) {
						lines.push(
							truncateToWidth(
								theme.fg("muted", `... ${preview.skippedLineCount} more lines (Ctrl+o to expand)`),
								width,
								theme.fg("muted", "..."),
							),
						);
					}
					lines.push(truncateToWidth(completion, width, theme.fg("muted", "...")));
					return lines;
				},
			};
		},
	});
}
