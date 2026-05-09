import * as os from "node:os";
import type { Message } from "@mariozechner/pi-ai";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	formatContextDisplay,
	formatCost,
	formatModelDisplay,
} from "../../ui/statusline/usage-format.js";
import type { AgentConfig, SwarmConfig } from "./agents.js";
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

function getMessageText(message: Message): string {
	if (message.role !== "assistant" && message.role !== "toolResult") return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const text = getMessageText(messages[i]);
		if (text) return text;
	}
	return "";
}

function escapeXmlAttributeValue(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function toCdataSafeText(value: string): string {
	return value.replace(/\]\]>/g, "]]" + "]]><![CDATA[>");
}

export function getParentVisibleResultText(result: SingleResult): string {
	const text = isResultError(result) ? getResultErrorText(result) : getFinalOutput(result.messages);
	if (!result.sessionId) return text;
	return [
		`Subagent resume ID: ${result.sessionId}`,
		`To ask this same subagent a follow-up, call subagent with resume: "${result.sessionId}".`,
		`<subagent-resume-id>${result.sessionId}</subagent-resume-id>`,
		"",
		text,
	].join("\n");
}

export function getParentVisibleSwarmResultText(
	results: SingleResult[],
	resumeId?: string,
): string {
	const output = formatSwarmResults(results);
	if (!resumeId) return output;
	return [
		`Subagent resume ID: ${resumeId}`,
		`To ask this same swarm a follow-up, call subagent with resume: "${resumeId}".`,
		`<subagent-resume-id>${resumeId}</subagent-resume-id>`,
		"",
		output,
	].join("\n");
}

export function formatSwarmMemberResult(result: SingleResult): string {
	const status = isResultError(result) ? "error" : "ok";
	const text = isResultError(result) ? getResultErrorText(result) : getFinalOutput(result.messages);
	const safeText = text || "(no output)";
	const safeBody = toCdataSafeText(safeText);
	const resume = result.resumed ? ' resume="true"' : "";
	const safeName = escapeXmlAttributeValue(result.agent);
	return [
		`<member name="${safeName}" status="${status}"${resume}><![CDATA[`,
		safeBody,
		"]]></member>",
	].join("\n");
}

export function formatSwarmResults(results: SingleResult[]): string {
	return results.map(formatSwarmMemberResult).join("\n\n");
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

export function getAvailableAgentsText(agents: AgentConfig[]): string {
	return agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
}

export function getAvailableSwarmsText(swarms: SwarmConfig[]): string {
	return swarms.map((swarm) => `${swarm.name} (${swarm.source})`).join(", ") || "none";
}

export function formatDebugSection(title: string, agents: AgentConfig[]): string {
	const lines = [title];
	if (agents.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}

	for (const agent of agents) {
		lines.push(
			`- ${agent.name} [${agent.source}]${agent.hidden ? " (hidden from prompt inventory)" : ""}`,
		);
		lines.push(`  file: ${agent.filePath}`);
		if (agent.model) lines.push(`  resolved model: ${agent.model}`);
		if (agent.tools.length) lines.push(`  normalized tools: ${agent.tools.join(", ")}`);
		else lines.push("  normalized tools: (empty tool set)");
	}
	return lines.join("\n");
}

export function formatDebugSwarmSection(title: string, swarms: SwarmConfig[]): string {
	const lines = [title];
	if (swarms.length === 0) {
		lines.push("(none)");
		return lines.join("\n");
	}

	for (const swarm of swarms) {
		lines.push(
			`- ${swarm.name} [${swarm.source}]${swarm.hidden ? " (hidden from prompt inventory)" : ""}`,
		);
		lines.push(`  file: ${swarm.filePath}`);
		if (swarm.members.length) lines.push(`  members: ${swarm.members.join(", ")}`);
		else lines.push("  members: (none)");
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

function getSessionModeLabel(resumed: boolean | undefined) {
	return resumed ? "resumed" : "fresh";
}

export function renderSubagentCall(args: Partial<TaskRequest>, theme: any) {
	const preview = args.task && args.task.length > 40 ? `${args.task.slice(0, 40)}...` : args.task;
	let text = theme.fg("toolTitle", theme.bold("subagent "));
	if (args.agent) text += theme.fg("accent", args.agent);
	text += theme.fg("dim", ` (${getSessionModeLabel(Boolean(args.resume))})`);
	if (preview) text += theme.fg("dim", ` ${preview}`);
	return new Text(text, 0, 0);
}

export function renderSubagentResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
	const details = result.details as SubagentDetails | undefined;
	if (!details?.results.length) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();
	const hasMultipleResults = details.results.length > 1;
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

	const renderExpandedOutput = (singleResult: SingleResult) => {
		const finalOutput = isResultError(singleResult)
			? getResultErrorText(singleResult).trim()
			: getFinalOutput(singleResult.messages).trim();
		const usageStr = formatUsageStats(singleResult.usage, getResultUsageOptions(singleResult));

		if (!finalOutput) {
			const displayItems = getDisplayItems(singleResult.messages);
			let text =
				displayItems.length > 0
					? renderDisplayItems(displayItems)
					: theme.fg("muted", "(no output)");
			if (usageStr) text += `\n\n${theme.fg("dim", usageStr)}`;
			return new Text(text, 0, 0);
		}

		if (isResultError(singleResult)) {
			let text = theme.fg("error", finalOutput);
			if (usageStr) text += `\n\n${theme.fg("dim", usageStr)}`;
			return new Text(text, 0, 0);
		}

		if (!usageStr) return new Markdown(finalOutput, 0, 0, mdTheme);

		const container = new Container();
		container.addChild(new Markdown(finalOutput, 0, 0, mdTheme));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
		return container;
	};

	const renderCollapsedOutput = (singleResult: SingleResult) => {
		const displayItems = getDisplayItems(singleResult.messages);
		const finalOutput = isResultError(singleResult)
			? getResultErrorText(singleResult)
			: getFinalOutput(singleResult.messages);
		if (displayItems.length === 0) {
			if (singleResult.exitCode === RUNNING_EXIT_CODE) {
				return theme.fg("muted", "(running...)");
			}
			if (finalOutput) {
				return theme.fg(
					isResultError(singleResult) ? "error" : "toolOutput",
					finalOutput.split("\n").slice(0, 3).join("\n"),
				);
			}
			return theme.fg("muted", "(no output)");
		}
		return renderDisplayItems(displayItems, 5);
	};

	const renderExpandedResults = () => {
		const container = new Container();
		for (let i = 0; i < details.results.length; i++) {
			const singleResult = details.results[i];
			container.addChild(
				new Text(
					theme.fg(
						"toolTitle",
						`subagent ${singleResult.agent} (${getSessionModeLabel(Boolean(singleResult.resumed))})`,
					),
					0,
					0,
				),
			);
			container.addChild(renderExpandedOutput(singleResult));
			if (i < details.results.length - 1) {
				container.addChild(new Spacer(1));
			}
		}
		return container;
	};

	const renderCollapsedResults = () => {
		const lines: string[] = [];
		for (const singleResult of details.results) {
			if (hasMultipleResults) {
				lines.push(
					theme.fg(
						"toolTitle",
						`subagent ${singleResult.agent} (${getSessionModeLabel(Boolean(singleResult.resumed))})`,
					),
				);
			}
			lines.push(renderCollapsedOutput(singleResult));
			if (hasMultipleResults) lines.push("");
		}
		if (!expanded) lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
		return new Text(lines.join("\n").trimEnd(), 0, 0);
	};

	const hasRunningResult = details.results.some((r) => r.exitCode === RUNNING_EXIT_CODE);
	if (expanded && !hasRunningResult) {
		if (hasMultipleResults) return renderExpandedResults();
		return renderExpandedOutput(details.results[0]);
	}

	return renderCollapsedResults();
}
