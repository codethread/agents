import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatCost, formatModelDisplay, formatTokens } from "./usage-format.js";

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

export type StatuslineItemRenderDeps = Omit<FooterRenderDeps, "width"> & {
	width?: number;
	debug?: boolean;
};

export function isLongCacheRetentionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_CACHE_RETENTION === "long";
}

function formatCacheTime(timestamp: string | number | Date): string {
	return new Date(timestamp).toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function getCacheStatusDisplay(
	entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
): string | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const assistant = entry.message as AssistantMessage;
		if (assistant.usage.cacheRead > 0) return `[${formatCacheTime(entry.timestamp)}]`;
	}
	return null;
}

function formatCostLine(costDisplay: string, cacheStatusDisplay: string | null): string {
	return [cacheStatusDisplay, costDisplay].filter(Boolean).join(" ");
}

function formatStatuslineContext(contextTokens: number | null, contextWindow: number): string {
	const current = contextTokens === null ? "?" : formatTokens(contextTokens);
	const maximum = contextWindow > 0 ? formatTokens(contextWindow) : "?";
	return `${current}/${maximum}`;
}

function formatProviderMarker(usingSubscription: boolean): string | undefined {
	const markers = [usingSubscription ? "sub" : null, isLongCacheRetentionEnabled() ? "L" : null];
	return markers.filter(Boolean).join(" ") || undefined;
}

const WIDE_LAYOUT_MIN_WIDTH = 100;

function renderBalancedRow(items: string[], width: number, ellipsis: string): string {
	if (!Number.isFinite(width)) return items.join("   ");
	const totalItemWidth = items.reduce((sum, item) => sum + visibleWidth(item), 0);
	const gapCount = items.length - 1;
	if (gapCount <= 0 || totalItemWidth + gapCount > width) {
		return truncateToWidth(items.join(" "), width, ellipsis);
	}

	const availableGapWidth = width - totalItemWidth;
	const baseGap = Math.floor(availableGapWidth / gapCount);
	let remainder = availableGapWidth - baseGap * gapCount;
	return items
		.map((item, index) => {
			if (index === items.length - 1) return item;
			const gapWidth = baseGap + (remainder > 0 ? 1 : 0);
			remainder--;
			return `${item}${" ".repeat(gapWidth)}`;
		})
		.join("");
}

export function renderStatuslineItems({
	ctx,
	pi,
	footerData,
	theme,
	width = Number.POSITIVE_INFINITY,
	debug = false,
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

	const branchEntries = ctx.sessionManager.getBranch();
	let totalCost = 0;
	for (const entry of branchEntries) {
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

	const contextDisplay = formatStatuslineContext(contextTokens, contextWindow);
	const overrideDisplay = extensionStatuses.has("provider-override") ? " (override)" : "";
	const cacheStatusDisplay = getCacheStatusDisplay(branchEntries);
	const costDisplay = `${formatCostLine(formatCost(totalCost, false, 3), cacheStatusDisplay)}${overrideDisplay}`;

	let styledContextDisplay = theme.fg("dim", contextDisplay);
	if (contextPercentValue > 90) {
		styledContextDisplay = theme.fg("error", contextDisplay);
	} else if (contextPercentValue > 70) {
		styledContextDisplay = theme.fg("warning", contextDisplay);
	}

	const providerMarker = formatProviderMarker(usingSubscription);
	const modelDisplay = formatModelDisplay({
		provider: ctx.model?.provider,
		providerMarker,
		providerPosition: "after",
		model: ctx.model?.id,
		thinkingLevel: pi.getThinkingLevel(),
		reasoning: ctx.model?.reasoning,
		includeProvider: footerData.getAvailableProviderCount() > 1 || providerMarker !== undefined,
	});

	const ellipsis = theme.fg("dim", "...");
	const agentIdentity = getAgentIdentity();
	const pathItem = theme.fg("dim", pwd);
	const agentItem = agentIdentity ? theme.fg("accent", agentIdentity) : null;
	const costItem = theme.fg("dim", costDisplay);
	const modelItem = theme.fg("dim", modelDisplay);
	const topItems = [pathItem, agentItem, modelItem].filter((item): item is string => Boolean(item));
	const minimumTopWidth =
		topItems.reduce((sum, item) => sum + visibleWidth(item), 0) + topItems.length - 1;
	const useWideLayout = width >= WIDE_LAYOUT_MIN_WIDTH && minimumTopWidth <= width;
	let items: string[];
	if (useWideLayout) {
		const bottomItems = [`${styledContextDisplay} ${costItem}`];
		const sessionItem = sessionLabel && theme.fg("dim", sessionLabel);
		if (sessionItem && visibleWidth(bottomItems[0]) + 1 + visibleWidth(sessionItem) <= width) {
			bottomItems.push(sessionItem);
		}
		items = [
			renderBalancedRow(topItems, width, ellipsis),
			renderBalancedRow(bottomItems, width, ellipsis),
		];
	} else {
		const bottomItems = [`${styledContextDisplay} ${costItem}`];
		const sessionItem = sessionLabel && theme.fg("dim", sessionLabel);
		if (sessionItem && visibleWidth(bottomItems[0]) + 1 + visibleWidth(sessionItem) <= width) {
			bottomItems.push(sessionItem);
		}
		items = [
			truncateToWidth(pathItem, width, ellipsis),
			...(agentItem ? [truncateToWidth(agentItem, width, ellipsis)] : []),
			truncateToWidth(modelItem, width, ellipsis),
			renderBalancedRow(bottomItems, width, ellipsis),
		];
	}

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

	if (debug) {
		items.push(
			theme.fg(
				"muted",
				`statusline ${useWideLayout ? "wide" : "thin"} width=${width} rows=${items.length}`,
			),
		);
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

	const branchEntries = ctx.sessionManager.getBranch();
	let totalCost = 0;
	for (const entry of branchEntries) {
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

	const contextDisplay = formatStatuslineContext(contextTokens, contextWindow);
	const overrideDisplay = extensionStatuses.has("provider-override") ? " (override)" : "";
	const cacheStatusDisplay = getCacheStatusDisplay(branchEntries);
	const costDisplay = `${formatCostLine(formatCost(totalCost, false, 3), cacheStatusDisplay)}${overrideDisplay}`;

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

	const providerMarker = formatProviderMarker(usingSubscription);
	const modelDisplay = formatModelDisplay({
		provider: ctx.model?.provider,
		providerMarker,
		providerPosition: "after",
		model: ctx.model?.id,
		thinkingLevel: pi.getThinkingLevel(),
		reasoning: ctx.model?.reasoning,
		includeProvider: footerData.getAvailableProviderCount() > 1 || providerMarker !== undefined,
	});

	const agentIdentity = getAgentIdentity();
	const topItems = [
		theme.fg("dim", pwd),
		agentIdentity ? theme.fg("accent", agentIdentity) : null,
		theme.fg("dim", modelDisplay),
	].filter((item): item is string => Boolean(item));
	const bottomItems = [
		leftSide,
		width >= WIDE_LAYOUT_MIN_WIDTH && sessionLabel ? theme.fg("dim", sessionLabel) : null,
	].filter((item): item is string => Boolean(item));
	const lines = [
		renderBalancedRow(topItems, width, theme.fg("dim", "...")),
		renderBalancedRow(bottomItems, width, theme.fg("dim", "...")),
	];

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

function getAgentIdentity(env: NodeJS.ProcessEnv = process.env): string | null {
	const identity = sanitizeStatusText(env.MILLSTRAND_AGENT_ID ?? "");
	return identity || null;
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
