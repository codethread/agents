import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
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

export interface StatuslineItemRenderDeps {
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	footerData: Omit<ReadonlyFooterDataProvider, "onBranchChange">;
	theme: Pick<Theme, "fg">;
	width?: number;
	debug?: boolean;
}

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
	const remainder = availableGapWidth % gapCount;
	return items
		.map((item, index) => {
			if (index === items.length - 1) return item;
			const gapWidth = baseGap + (index < remainder ? 1 : 0);
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
		ctx.sessionManager.getSessionId(),
	);

	let totalCost = 0;
	let cacheTimestamp: string | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		totalCost += entry.message.usage.cost.total;
		if (entry.message.usage.cacheRead > 0) cacheTimestamp = entry.timestamp;
	}

	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextTokens = contextUsage?.tokens ?? null;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;

	const contextDisplay = formatStatuslineContext(contextTokens, contextWindow);
	const overrideDisplay = extensionStatuses.has("provider-override") ? " (override)" : "";
	const cacheDisplay = cacheTimestamp === undefined ? "" : `[${formatCacheTime(cacheTimestamp)}] `;
	const costDisplay = `${cacheDisplay}${formatCost(totalCost)}${overrideDisplay}`;
	const contextColor =
		contextPercentValue > 90 ? "error" : contextPercentValue > 70 ? "warning" : "dim";
	const styledContextDisplay = theme.fg(contextColor, contextDisplay);

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
	const agentIdentity = sanitizeStatusText(extensionStatuses.get("millstrand-identity") ?? "");
	const pathItem = theme.fg("dim", pwd);
	const agentItem = agentIdentity ? theme.fg("accent", agentIdentity) : null;
	const costItem = theme.fg("dim", costDisplay);
	const modelItem = theme.fg("dim", modelDisplay);
	const topItems = [pathItem, agentItem, modelItem].filter((item): item is string => Boolean(item));
	const minimumTopWidth =
		topItems.reduce((sum, item) => sum + visibleWidth(item), 0) + topItems.length - 1;
	const useWideLayout = width >= WIDE_LAYOUT_MIN_WIDTH && minimumTopWidth <= width;
	const items = useWideLayout
		? [renderBalancedRow(topItems, width, ellipsis)]
		: topItems.map((item) => truncateToWidth(item, width, ellipsis));

	const bottomItems = [`${styledContextDisplay} ${costItem}`];
	const sessionItem = sessionLabel && theme.fg("dim", sessionLabel);
	if (sessionItem && visibleWidth(bottomItems[0]) + 1 + visibleWidth(sessionItem) <= width) {
		bottomItems.push(sessionItem);
	}
	items.push(renderBalancedRow(bottomItems, width, ellipsis));

	items.push(
		...Array.from(extensionStatuses)
			.filter(([key]) => key !== "provider-override" && key !== "millstrand-identity")
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text)),
	);

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
	pi.registerFlag("debug-statusline", {
		description: "Show statusline layout diagnostics in the footer",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, theme, footerData) => ({
			dispose: footerData.onBranchChange(() => tui.requestRender()),
			invalidate() {},
			render(width: number): string[] {
				return renderStatuslineItems({
					ctx,
					pi,
					footerData,
					theme,
					width,
					debug: pi.getFlag("debug-statusline") === true,
				}).map((line) => truncateToWidth(line, width, theme.fg("dim", "...")));
			},
		}));
	});
}
