import {
	createEditTool,
	createEditToolDefinition,
	type EditToolDetails,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

type EditArgs = {
	path?: string;
	edits?: Array<{
		oldText?: string;
		newText?: string;
	}>;
};

const EXPANDED_BODY_LIMIT = 200;

function countLines(text: string | undefined) {
	if (!text) return 0;
	const count = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
	return Math.max(0, count);
}

function countEditLines(args: EditArgs) {
	let adds = 0;
	let removes = 0;
	for (const edit of args.edits ?? []) {
		adds += countLines(edit.newText);
		removes += countLines(edit.oldText);
	}
	return { adds, removes };
}

function countDiffLines(diff: string) {
	let adds = 0;
	let removes = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+")) adds += 1;
		else if (line.startsWith("-")) removes += 1;
	}
	return { adds, removes };
}

function formatStats(editCount: number, adds: number, removes: number) {
	const editPrefix = editCount > 1 ? `${editCount} edits ` : "";
	return `${editPrefix}+${adds}/-${removes}`;
}

function renderExpandedArgs(
	args: EditArgs,
	theme: Parameters<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"]>>[1],
) {
	const lines: string[] = [];
	for (const edit of args.edits ?? []) {
		for (const removed of (edit.oldText ?? "").split("\n").filter(Boolean)) {
			if (lines.length >= EXPANDED_BODY_LIMIT) return lines;
			lines.push(theme.fg("toolDiffRemoved", `- ${removed}`));
		}
		for (const added of (edit.newText ?? "").split("\n").filter(Boolean)) {
			if (lines.length >= EXPANDED_BODY_LIMIT) return lines;
			lines.push(theme.fg("toolDiffAdded", `+ ${added}`));
		}
	}
	return lines;
}

function renderExpandedDiff(
	diff: string,
	theme: Parameters<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"]>>[1],
) {
	return diff
		.split("\n")
		.slice(0, EXPANDED_BODY_LIMIT)
		.map((line) => {
			if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
			if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
			return theme.fg("toolDiffContext", line);
		});
}

export default function (pi: ExtensionAPI) {
	const builtinEdit = createEditTool(process.cwd());
	const builtinEditDefinition = createEditToolDefinition(process.cwd());

	pi.registerTool({
		...builtinEdit,
		name: "edit",
		renderShell: "default",

		renderCall(args, theme, context) {
			const typedArgs = args as EditArgs;
			const state = context.state as { diff?: string };
			const path = typedArgs.path ?? "(unknown)";
			const counts = state.diff ? countDiffLines(state.diff) : countEditLines(typedArgs);
			const editCount = typedArgs.edits?.length ?? 0;
			const prefix = context.argsComplete || state.diff ? "" : "...";
			const header = `${theme.fg("toolTitle", theme.bold("edit "))}${theme.fg("muted", path)} ${theme.fg("dim", `(${prefix}${formatStats(editCount, counts.adds, counts.removes)})`)}`;
			const body = context.expanded
				? state.diff
					? renderExpandedDiff(state.diff, theme)
					: renderExpandedArgs(typedArgs, theme)
				: [];

			return new Text([header, ...body].join("\n"), 0, 0);
		},

		renderResult(result, options, theme, context) {
			if (context.isError) {
				return (
					builtinEditDefinition.renderResult?.(result, options, theme, context) ??
					new Text("", 0, 0)
				);
			}

			const details = result.details as EditToolDetails | undefined;
			(context.state as { diff?: string }).diff = details?.diff;
			return new Container();
		},
	});
}
