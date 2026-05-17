import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { Config, SizeConfig } from "./types.js";
import type { Animator } from "./animator.js";
import type { RenderedFrame } from "./renderer.js";
import { log } from "./log.js";

type RenderConfig = Omit<Config, "size"> & { size: number };

// --- Token formatting ---

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 10_000) return `${Math.round(count / 1000)}k`;
	if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`;
	return count.toString();
}

// --- Info panel ---

function buildInfoLines(
	width: number,
	config: RenderConfig,
	ctxRef: any,
	pi: any,
	theme: any,
): string[] {
	const lines: string[] = [];
	if (!ctxRef) return lines;

	const model = ctxRef.model;
	let modelStr = model?.name ?? "no model";
	const thinkingLevel = pi.getThinkingLevel?.() ?? "high";
	if (model?.reasoning) {
		modelStr += ` • ${thinkingLevel}`;
	}
	lines.push(theme.bold(modelStr));

	const usage = ctxRef.getContextUsage?.();
	if (usage) {
		const pct = usage.percent !== null ? `${usage.percent.toFixed(1)}%` : "?";
		const tokens = usage.tokens !== null ? formatTokens(usage.tokens) : "?";
		const window = formatTokens(usage.contextWindow);
		lines.push(`Context: ${tokens}/${window} (${pct})`);
	}

	let totalInput = 0;
	let totalOutput = 0;
	let totalCost = 0;
	try {
		for (const entry of ctxRef.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage?.input ?? 0;
				totalOutput += entry.message.usage?.output ?? 0;
				totalCost += entry.message.usage?.cost?.total ?? 0;
			}
		}
	} catch {
		/* ignore if not available */
	}

	lines.push(`↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)}`);

	lines.push(`$${totalCost.toFixed(3)}`);

	const infoWidth = width - config.size - 5;
	return lines.map((l) => {
		if (visibleWidth(l) > infoWidth) return truncateToWidth(l, infoWidth, "…");
		return l;
	});
}

// --- Render helpers ---

/**
 * Kitty image layout: image sequence on row 0 (zero-width, cursor doesn't move),
 * avatarPad fills the space. Info text beside the image on all rows.
 */
function renderKittyFrame(
	frame: RenderedFrame & { kind: "image" },
	width: number,
	config: RenderConfig,
	infoLines: string[],
	borderColor: (s: string) => string,
): string[] {
	const sep = borderColor("│");
	const leftMargin = " ";
	const avatarPad = " ".repeat(config.size);
	const avatarSkip = `\x1b[${config.size}C`;
	const useSkip = frame.padMode === "skip";
	const lines: string[] = [];

	for (let i = 0; i < frame.rows; i++) {
		if (i === 0) {
			const pad = useSkip ? avatarSkip : avatarPad;
			lines.push(leftMargin + frame.sequence + `${pad} ${sep} ${infoLines[i] ?? ""}`);
		} else {
			lines.push(`${leftMargin}${avatarPad} ${sep} ${infoLines[i] ?? ""}`);
		}
	}

	return lines;
}

/**
 * Unicode placeholder layout: placeholder text lines fill rows 0–N.
 * Each line is already config.size wide (placeholder chars). Info beside it.
 */
function renderPlaceholderFrame(
	frame: RenderedFrame & { kind: "placeholder" },
	width: number,
	config: RenderConfig,
	infoLines: string[],
	borderColor: (s: string) => string,
): string[] {
	const sep = borderColor("│");
	const leftMargin = " ";
	const lines: string[] = [];

	for (let i = 0; i < frame.rows; i++) {
		lines.push(`${leftMargin}${frame.lines[i] ?? ""} ${sep} ${infoLines[i] ?? ""}`);
	}

	return lines;
}

// --- Widget factory ---

export interface WidgetDeps {
	animator: Animator;
	config: Config;
	pi: any;
	getCtxRef: () => any;
	getCurrentEmoteSet: () => string;
}

function resolveAvatarSize(width: number, sizeConfig: SizeConfig): number | null {
	if (typeof sizeConfig === "number") return sizeConfig;

	let resolved: number | null = null;
	for (const [minWidthText, size] of Object.entries(sizeConfig)) {
		const minWidth = Number(minWidthText);
		if (!Number.isFinite(minWidth)) continue;
		if (minWidth <= width) resolved = size;
	}
	return resolved;
}

export function createWidgetFactory(deps: WidgetDeps) {
	let activeAvatarSize: number | null = null;
	return (_tui: any, theme: any) => {
		deps.animator.setTui(_tui);
		return {
			render(width: number): string[] {
				const { animator, config } = deps;

				if (width < config.hideBelow) return [];

				const avatarSize = resolveAvatarSize(width, config.size);
				if (avatarSize === null) return [];
				if (avatarSize !== activeAvatarSize) {
					activeAvatarSize = avatarSize;
					animator.setRenderSize(avatarSize);
				}

				const renderConfig: RenderConfig = { ...config, size: avatarSize };
				const frame = animator.getRenderedFrame();
				if (!frame) {
					log(`render: no frame`);
					return [];
				}

				log(`render: kind=${frame.kind}, set="${deps.getCurrentEmoteSet()}"`);

				const thinkingLevel = deps.pi.getThinkingLevel?.() ?? "high";
				const borderColor =
					(theme as any).getThinkingBorderColor?.(thinkingLevel) ??
					((s: string) => theme.fg("border", s));
				const border = borderColor("─".repeat(width));
				const infoLines = buildInfoLines(width, renderConfig, deps.getCtxRef(), deps.pi, theme);

				const lines: string[] = [];
				lines.push(border);

				if (frame.kind === "image") {
					lines.push(...renderKittyFrame(frame, width, renderConfig, infoLines, borderColor));
				} else {
					lines.push(...renderPlaceholderFrame(frame, width, renderConfig, infoLines, borderColor));
				}

				return lines;
			},
			invalidate() {},
			dispose() {
				deps.animator.setTui(null);
			},
		};
	};
}
