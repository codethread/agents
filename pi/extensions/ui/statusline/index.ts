import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatContextDisplay, formatCost, formatModelDisplay } from "./usage-format.js";

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function shortenHome(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

function renderTimelineTimestampItems(
	ctx: ExtensionContext,
	theme: { fg(color: string, text: string): string },
	width: number,
): string[] {
	return ctx.sessionManager
		.getBranch()
		.filter(
			(entry) => entry.type === "custom" && entry.customType === "timeline-timestamps-tool-call",
		)
		.slice(-3)
		.map(
			(entry) =>
				entry as {
					timestamp: string | number | Date;
					data?: { toolName?: string; preview?: string };
				},
		)
		.map((entry) => {
			const timestamp = new Date(entry.timestamp);
			const formatted = timestamp.toLocaleTimeString("en-GB", { hour12: false });
			const toolName = entry.data?.toolName?.trim() || "tool";
			const preview = entry.data?.preview?.trim();
			const text = preview
				? `${theme.fg("dim", "- ")}${theme.fg("accent", toolName)}${theme.fg("dim", `: ${formatted} | `)}${theme.fg("muted", preview)}`
				: `${theme.fg("dim", "- ")}${theme.fg("accent", toolName)}${theme.fg("dim", `: ${formatted}`)}`;
			return truncateToWidth(text, width, theme.fg("dim", "..."));
		});
}

export interface FooterRenderDeps {
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	footerData: {
		getGitBranch(): string | null;
		getExtensionStatuses(): ReadonlyMap<string, string>;
		getAvailableProviderCount(): number;
	};
	theme: {
		fg(color: string, text: string): string;
	};
	width: number;
}

export type StatuslineItemRenderDeps = Omit<FooterRenderDeps, "width"> & { width?: number };

export function isLongCacheRetentionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_CACHE_RETENTION === "long";
}

function formatCostLine(costDisplay: string): string {
	return isLongCacheRetentionEnabled() ? `${costDisplay} • cache long` : costDisplay;
}

export function renderStatuslineItems({
	ctx,
	pi,
	footerData,
	theme,
	width = Number.POSITIVE_INFINITY,
}: StatuslineItemRenderDeps): string[] {
	const extensionStatuses = footerData.getExtensionStatuses();
	let pwd = shortenHome(ctx.cwd);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;

	const sessionLabel = formatSessionLabel(
		ctx.sessionManager.getSessionName(),
		typeof (ctx.sessionManager as { getSessionId?: () => string | undefined }).getSessionId ===
			"function"
			? (ctx.sessionManager as { getSessionId: () => string | undefined }).getSessionId()
			: undefined,
	);
	if (sessionLabel) pwd = `${pwd} • ${sessionLabel}`;

	let totalCost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const assistant = entry.message as AssistantMessage;
			totalCost += assistant.usage.cost.total;
		}
	}

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextTokens = contextUsage?.tokens ?? null;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;

	const contextDisplay = formatContextDisplay({
		contextTokens,
		contextWindow,
		contextPercent: contextUsage?.percent,
	});
	const overrideDisplay = extensionStatuses.has("provider-override") ? " (override)" : "";
	const costDisplay = `${formatCostLine(formatCost(totalCost, usingSubscription, 3))}${overrideDisplay}`;

	let styledContextDisplay = theme.fg("dim", contextDisplay);
	if (contextPercentValue > 90) {
		styledContextDisplay = theme.fg("error", contextDisplay);
	} else if (contextPercentValue > 70) {
		styledContextDisplay = theme.fg("warning", contextDisplay);
	}

	const modelDisplay = formatModelDisplay({
		provider: footerData.getAvailableProviderCount() > 1 ? ctx.model?.provider : undefined,
		model: ctx.model?.id,
		thinkingLevel: pi.getThinkingLevel(),
		reasoning: ctx.model?.reasoning,
		includeProvider: footerData.getAvailableProviderCount() > 1,
	});

	const items = [
		truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
		styledContextDisplay,
		theme.fg("dim", costDisplay),
		theme.fg("dim", modelDisplay),
	];

	const visibleExtensionStatuses = Array.from(extensionStatuses.entries()).filter(
		([key]) => key !== "timeline-timestamps" && key !== "provider-override",
	);
	items.push(
		...visibleExtensionStatuses
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text)),
	);

	if (extensionStatuses.has("timeline-timestamps")) {
		items.push(...renderTimelineTimestampItems(ctx, theme, width));
	}

	return items;
}

export function renderStatuslineLines({
	ctx,
	pi,
	footerData,
	theme,
	width,
}: FooterRenderDeps): string[] {
	const extensionStatuses = footerData.getExtensionStatuses();
	let pwd = shortenHome(ctx.cwd);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;

	const sessionLabel = formatSessionLabel(
		ctx.sessionManager.getSessionName(),
		typeof (ctx.sessionManager as { getSessionId?: () => string | undefined }).getSessionId ===
			"function"
			? (ctx.sessionManager as { getSessionId: () => string | undefined }).getSessionId()
			: undefined,
	);
	if (sessionLabel) pwd = `${pwd} • ${sessionLabel}`;

	let totalCost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const assistant = entry.message as AssistantMessage;
			totalCost += assistant.usage.cost.total;
		}
	}

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextTokens = contextUsage?.tokens ?? null;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;

	const contextDisplay = formatContextDisplay({
		contextTokens,
		contextWindow,
		contextPercent: contextUsage?.percent,
	});
	const overrideDisplay = extensionStatuses.has("provider-override") ? " (override)" : "";
	const costDisplay = `${formatCostLine(formatCost(totalCost, usingSubscription, 3))}${overrideDisplay}`;

	let styledContextDisplay = theme.fg("dim", contextDisplay);
	if (contextPercentValue > 90) {
		styledContextDisplay = theme.fg("error", contextDisplay);
	} else if (contextPercentValue > 70) {
		styledContextDisplay = theme.fg("warning", contextDisplay);
	}

	const leftParts = [styledContextDisplay, theme.fg("dim", costDisplay)];
	let leftSide = leftParts.join(" ");
	let leftSideWidth = visibleWidth(leftSide);
	if (leftSideWidth > width) {
		leftSide = truncateToWidth(leftSide, width, theme.fg("dim", "..."));
		leftSideWidth = visibleWidth(leftSide);
	}

	const rightSide = formatModelDisplay({
		provider: footerData.getAvailableProviderCount() > 1 ? ctx.model?.provider : undefined,
		model: ctx.model?.id,
		thinkingLevel: pi.getThinkingLevel(),
		reasoning: ctx.model?.reasoning,
		includeProvider: footerData.getAvailableProviderCount() > 1,
	});

	const minPadding = 2;
	const rightSideWidth = visibleWidth(rightSide);
	const totalNeeded = leftSideWidth + minPadding + rightSideWidth;
	let statsLine: string;
	if (totalNeeded <= width) {
		const padding = " ".repeat(width - leftSideWidth - rightSideWidth);
		statsLine = leftSide + padding + theme.fg("dim", rightSide);
	} else {
		const availableForRight = width - leftSideWidth - minPadding;
		if (availableForRight > 0) {
			const truncatedRight = truncateToWidth(theme.fg("dim", rightSide), availableForRight, "");
			const padding = " ".repeat(Math.max(0, width - leftSideWidth - visibleWidth(truncatedRight)));
			statsLine = leftSide + padding + truncatedRight;
		} else {
			statsLine = leftSide;
		}
	}

	const lines = [truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")), statsLine];

	const visibleExtensionStatuses = Array.from(extensionStatuses.entries()).filter(
		([key]) => key !== "timeline-timestamps" && key !== "provider-override",
	);
	if (visibleExtensionStatuses.length > 0) {
		const sortedStatuses = visibleExtensionStatuses
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text));
		const statusLine = sortedStatuses.join(" ");
		lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
	}

	if (extensionStatuses.has("timeline-timestamps")) {
		lines.push(...renderTimelineTimestampItems(ctx, theme, width));
	}

	return lines;
}

export function formatSessionLabel(
	sessionName: string | null | undefined,
	sessionId: string | null | undefined,
): string | null {
	const name = sessionName ? sanitizeStatusText(sessionName) : "";
	const id = sessionId ? sanitizeStatusText(sessionId) : "";
	if (name && id) return `${name} (${id})`;
	if (name) return name;
	if (id) return `session ${id}`;
	return null;
}

export default function (pi: ExtensionAPI) {
	const installFooter = (ctx: ExtensionContext) => {
		ctx.ui.setFooter((_tui, _theme, _footerData) => ({
			invalidate() {},
			render(): string[] {
				return [];
			},
		}));
	};

	pi.on("session_start", (_event, ctx) => installFooter(ctx));
	(
		pi as ExtensionAPI & {
			on(event: "session_switch", handler: (_event: unknown, ctx: ExtensionContext) => void): void;
		}
	).on("session_switch", (_event, ctx) => installFooter(ctx));
}
