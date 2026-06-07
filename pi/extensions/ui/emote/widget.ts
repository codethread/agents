import { truncateToWidth } from "@earendil-works/pi-tui";
import { renderStatuslineItems } from "../statusline/index.js";
import { layoutFlexTextItems } from "./flex-layout.js";
import type { Config, SizeConfig } from "./types.js";
import type { Animator } from "./animator.js";
import type { RenderedFrame } from "./renderer.js";
import { log } from "./log.js";

type RenderConfig = Omit<Config, "size"> & { size: number };
export type EmoteWidgetPlacement = "aboveEditor" | "belowEditor";

// --- Canvas panel ---

function buildCanvasItems(width: number, deps: WidgetDeps, theme: any): string[] {
	const ctx = deps.getCtxRef();
	const footerData = deps.getFooterData();
	if (!ctx || !footerData || width <= 0) return [];
	return renderStatuslineItems({ ctx, pi: deps.pi, footerData, theme, width });
}

function buildCanvasLines(
	width: number,
	rows: number,
	deps: WidgetDeps,
	theme: any,
	config: RenderConfig,
): string[] {
	return layoutFlexTextItems(buildCanvasItems(width, deps, theme), {
		width,
		rows,
		ellipsis: theme.fg("dim", config.textEllipsis),
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
	const leftMargin = "";
	const avatarPad = " ".repeat(config.size);
	const avatarSkip = `\x1b[${config.size}C`;
	const useSkip = frame.padMode === "skip";
	const lines: string[] = [];

	for (let i = 0; i < frame.rows; i++) {
		if (i === 0) {
			const pad = useSkip ? avatarSkip : avatarPad;
			lines.push(leftMargin + frame.sequence + `${pad}${sep}${infoLines[i] ?? ""}`);
		} else {
			lines.push(`${leftMargin}${avatarPad}${sep}${infoLines[i] ?? ""}`);
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
	const leftMargin = "";
	const lines: string[] = [];

	for (let i = 0; i < frame.rows; i++) {
		lines.push(`${leftMargin}${frame.lines[i] ?? ""}${sep}${infoLines[i] ?? ""}`);
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
	getFooterData: () => any;
	getImageVisible: () => boolean;
	placement: EmoteWidgetPlacement;
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
				if (avatarSize === null || !deps.getImageVisible()) {
					activeAvatarSize = null;
					return buildCanvasItems(width, deps, theme).map((line) =>
						truncateToWidth(line, width, theme.fg("dim", config.textEllipsis)),
					);
				}
				if (avatarSize !== activeAvatarSize) {
					activeAvatarSize = avatarSize;
					animator.setRenderSize(avatarSize);
				}

				const renderConfig: RenderConfig = { ...config, size: avatarSize };
				const frame = animator.getRenderedFrame();
				if (!frame) {
					log(`render: no frame`);
					return buildCanvasItems(width, deps, theme).map((line) =>
						truncateToWidth(line, width, theme.fg("dim", config.textEllipsis)),
					);
				}

				log(`render: kind=${frame.kind}, set="${deps.getCurrentEmoteSet()}"`);

				const thinkingLevel = deps.pi.getThinkingLevel?.() ?? "high";
				const borderColor =
					(theme as any).getThinkingBorderColor?.(thinkingLevel) ??
					((s: string) => theme.fg("border", s));
				const border = borderColor("─".repeat(width));
				const infoLines = buildCanvasLines(
					width - renderConfig.size - 1,
					frame.rows,
					deps,
					theme,
					renderConfig,
				);

				const contentLines =
					frame.kind === "image"
						? renderKittyFrame(frame, width, renderConfig, infoLines, borderColor)
						: renderPlaceholderFrame(frame, width, renderConfig, infoLines, borderColor);

				return deps.placement === "belowEditor" ? contentLines : [...contentLines, border];
			},
			invalidate() {},
			dispose() {
				deps.animator.setTui(null);
			},
		};
	};
}
