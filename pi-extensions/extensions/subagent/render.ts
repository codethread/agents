import * as os from "node:os";
import type { Message } from "@mariozechner/pi-ai";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	formatContextDisplay,
	formatCost,
	formatModelDisplay,
} from "../current-context-footer/usage-format.js";
import type { AgentConfig } from "./agents.js";
import {
	RUNNING_EXIT_CODE,
	type DisplayItem,
	type SingleResult,
	type SubagentDetails,
	type TaskRequest,
} from "./types.js";

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		contextWindow?: number;
		contextPercent?: number | null;
		turns?: number;
	},
	options?: {
		provider?: string;
		model?: string;
		thinkingLevel?: string;
		reasoning?: boolean;
		usingSubscription?: boolean;
	},
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.contextTokens || usage.contextWindow) {
		parts.push(
			formatContextDisplay({
				contextTokens: usage.contextTokens,
				contextWindow: usage.contextWindow,
				contextPercent: usage.contextPercent,
			}),
		);
	}
	if (usage.cost || options?.usingSubscription)
		parts.push(formatCost(usage.cost, options?.usingSubscription, 4));
	if (options?.model) {
		parts.push(
			formatModelDisplay({
				provider: options.provider,
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				reasoning: options.reasoning,
				includeProvider: Boolean(options.provider),
			}),
		);
	}
	return parts.join(" ");
}

export function shortenHomePath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenHomePath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenHomePath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenHomePath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenHomePath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenHomePath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenHomePath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

export function isResultError(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

export function getResultErrorText(result: SingleResult): string {
	return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text") items.push({ type: "text", text: part.text });
			else if (part.type === "toolCall") {
				items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

export function aggregateUsage(results: SingleResult[]) {
	const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
	for (const result of results) {
		total.input += result.usage.input;
		total.output += result.usage.output;
		total.cacheRead += result.usage.cacheRead;
		total.cacheWrite += result.usage.cacheWrite;
		total.cost += result.usage.cost;
		total.turns += result.usage.turns;
	}
	return total;
}

export function getAvailableAgentsText(agents: AgentConfig[]): string {
	return agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
}

export function formatDebugSection(title: string, agents: AgentConfig[]): string {
	const lines = [title];
	if (agents.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}

	for (const agent of agents) {
		lines.push(`- ${agent.name} [${agent.source}]`);
		lines.push(`  file: ${agent.filePath}`);
		if (agent.model) lines.push(`  resolved model: ${agent.model}`);
		if (agent.tools.length) lines.push(`  normalized tools: ${agent.tools.join(", ")}`);
		else lines.push("  normalized tools: (empty tool set)");
	}
	return lines.join("\n");
}

export function getResultUsageOptions(result: SingleResult) {
	return {
		provider: result.provider,
		model: result.model,
		thinkingLevel: result.thinkingLevel,
		reasoning: result.reasoning,
		usingSubscription: result.usingSubscription,
	};
}

export function renderSubagentCall(args: { tasks?: TaskRequest[] }, theme: any) {
	const tasks = args.tasks ?? [];
	let text =
		theme.fg("toolTitle", theme.bold("subagent ")) +
		theme.fg("accent", `parallel (${tasks.length} tasks)`);
	for (const task of tasks.slice(0, 3)) {
		const preview = task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
		text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
	}
	if (tasks.length > 3) {
		text += `\n  ${theme.fg("muted", `... +${tasks.length - 3} more`)}`;
	}
	return new Text(text, 0, 0);
}

export function renderSubagentResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
	const details = result.details as SubagentDetails | undefined;
	if (!details?.results.length) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();
	const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
		const toShow = limit ? items.slice(-limit) : items;
		const skipped = limit && items.length > limit ? items.length - limit : 0;
		let text = "";
		if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
		for (const item of toShow) {
			if (item.type === "text") {
				const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
				text += `${theme.fg("toolOutput", preview)}\n`;
			} else {
				text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
			}
		}
		return text.trimEnd();
	};
	const addToolCallsAndOutput = (container: Container, singleResult: SingleResult) => {
		const displayItems = getDisplayItems(singleResult.messages);
		const finalOutput = getFinalOutput(singleResult.messages);

		if (displayItems.length === 0 && !finalOutput) {
			container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
			return;
		}

		for (const item of displayItems) {
			if (item.type !== "toolCall") continue;
			container.addChild(
				new Text(
					theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
					0,
					0,
				),
			);
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
		}
	};

	const running = details.results.filter(
		(singleResult) => singleResult.exitCode === RUNNING_EXIT_CODE,
	).length;
	const successCount = details.results.filter((singleResult) => singleResult.exitCode === 0).length;
	const failCount = details.results.filter(
		(singleResult) => singleResult.exitCode !== RUNNING_EXIT_CODE && isResultError(singleResult),
	).length;
	const isRunning = running > 0;
	const icon = isRunning
		? theme.fg("warning", "⏳")
		: failCount > 0
			? theme.fg("warning", "◐")
			: theme.fg("success", "✓");
	const status = isRunning
		? `${successCount + failCount}/${details.results.length} done, ${running} running`
		: `${successCount}/${details.results.length} tasks`;

	if (expanded && !isRunning) {
		const container = new Container();
		container.addChild(
			new Text(
				`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
				0,
				0,
			),
		);

		for (const singleResult of details.results) {
			const resultIcon = isResultError(singleResult)
				? theme.fg("error", "✗")
				: theme.fg("success", "✓");
			container.addChild(new Spacer(1));
			container.addChild(
				new Text(
					`${theme.fg("muted", "─── ") + theme.fg("accent", singleResult.agent)} ${resultIcon}`,
					0,
					0,
				),
			);
			container.addChild(
				new Text(theme.fg("muted", "Task: ") + theme.fg("dim", singleResult.task), 0, 0),
			);
			if (singleResult.sessionFile) {
				container.addChild(
					new Text(
						theme.fg("muted", "session: ") +
							theme.fg("dim", shortenHomePath(singleResult.sessionFile)),
						0,
						0,
					),
				);
			}
			addToolCallsAndOutput(container, singleResult);
			const usageStr = formatUsageStats(singleResult.usage, getResultUsageOptions(singleResult));
			if (usageStr) {
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
		}

		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
		}
		return container;
	}

	let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
	for (const singleResult of details.results) {
		const resultIcon =
			singleResult.exitCode === RUNNING_EXIT_CODE
				? theme.fg("warning", "⏳")
				: isResultError(singleResult)
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
		const displayItems = getDisplayItems(singleResult.messages);
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", singleResult.agent)} ${resultIcon}`;
		if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", singleResult.exitCode === RUNNING_EXIT_CODE ? "(running...)" : "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, 5)}`;
		}
	}
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(details.results));
		if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	}
	if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}
