import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { EmoteState, ResolvedRenderer } from "./types.js";
import type { Renderer } from "./renderer.js";
import { log, setDebug } from "./log.js";
import { loadLayeredConfig } from "./config.js";
import { resolveEmoteSet, findEmoteSetDir, loadEmotesConfig } from "./emotes.js";
import { KittyRenderer } from "./render_kitty.js";
import { TmuxKittyRenderer } from "./render_tmux_kitty.js";
import { TmuxKittyUnicodeRenderer } from "./render_tmux_kitty_unicode.js";
import { Animator } from "./animator.js";
import { createWidgetFactory, type EmoteWidgetPlacement } from "./widget.js";
import { resolveRenderer } from "./terminal.js";
import { buildEmoteGenPrompt } from "./emote-gen-prompt.js";

function toolNameToState(toolName: string): EmoteState {
	switch (toolName) {
		case "read":
			return "read";
		case "write":
		case "edit":
			return "write";
		default:
			return "tool";
	}
}

function getInitialSize(size: number | Record<string, number | null>): number {
	if (typeof size === "number") return size;
	return Object.values(size).find((value): value is number => typeof value === "number") ?? 6;
}

type EmoteVisibilityOverride = boolean | null;

type EmoteCommandAction = "toggle" | "on" | "off" | "status";

function parseEmoteCommandAction(args: string): EmoteCommandAction {
	const normalized = args.trim().toLowerCase();
	if (!normalized || normalized === "toggle") return "toggle";
	if (["on", "true", "1", "enable", "enabled", "show", "visible"].includes(normalized)) return "on";
	if (["off", "false", "0", "disable", "disabled", "hide", "hidden"].includes(normalized))
		return "off";
	if (["status"].includes(normalized)) return "status";
	throw new Error("Usage: /emote [toggle|on|off|status]");
}

function notify(
	ctx: {
		hasUI: boolean;
		ui?: { notify(message: string, level?: "info" | "warning" | "error"): void };
	},
	message: string,
	level: "info" | "warning" | "error" = "info",
) {
	if (ctx.hasUI && ctx.ui) {
		ctx.ui.notify(message, level);
		return;
	}
	process.stdout.write(`${message}\n`);
}

function createRendererFromResolved(resolved: ResolvedRenderer, size: number): Renderer {
	const { protocol, multiplexer } = resolved;
	if (protocol === "none") {
		return {
			setTui() {},
			loadFrames() {},
			getRenderedFrame: () => null,
			setSize() {},
			showFrame: () => false,
			showRandomFrame: () => false,
			showTalkFrame: () => false,
			showTalkCloseFrame: () => false,
			showCycleFrame: () => false,
			getCycleFrameCount: () => 0,
			dispose() {},
			resetCache() {},
		};
	}
	if (protocol === "kitty-unicode") {
		log(`createRenderer: using TmuxKittyUnicodeRenderer`);
		return new TmuxKittyUnicodeRenderer(size);
	}
	if (protocol === "kitty") {
		if (multiplexer === "tmux") {
			log(`createRenderer: using TmuxKittyRenderer`);
			return new TmuxKittyRenderer(size);
		}
		log(`createRenderer: using KittyRenderer`);
		return new KittyRenderer(size);
	}
	throw new Error(`Unsupported emote renderer protocol: ${protocol}`);
}

const DEBUG_EMOTE_FLAG = "debug-emote";
const EMOTE_FLAG = "emote";

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const widgetPlacement: EmoteWidgetPlacement = "belowEditor";

	pi.registerFlag(DEBUG_EMOTE_FLAG, {
		description: "Write pi-emote debug logs to pi/extensions/ui/emote/debug.log",
		type: "boolean",
		default: false,
	});

	pi.registerFlag(EMOTE_FLAG, {
		description: "Select the emote pack to use, e.g. --emote red",
		type: "string",
	});

	pi.registerCommand("emote-gen-prompt", {
		description: "Generate temporary image prompts for a Pi emote set",
		handler: async (args, ctx) => {
			const prompt = buildEmoteGenPrompt(args);
			if (!ctx.isIdle()) {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
				if (ctx.hasUI) ctx.ui.notify("Queued emote prompt generation as follow-up", "info");
				return;
			}

			await pi.sendUserMessage(prompt);
		},
	});

	let cwd = process.cwd();
	let { config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd);
	setDebug(config.debug || pi.getFlag(DEBUG_EMOTE_FLAG) === true);

	// Emote set state
	let currentEmoteSet = "default";
	let ctxRef: any = null;
	let footerDataRef: any = null;
	let widgetActive = false;
	let visibilityOverride: EmoteVisibilityOverride = null;
	let lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
	let renderer = createRendererFromResolved(lastResolved, getInitialSize(config.size));

	const animator = new Animator(config, renderer);

	function resolveSessionRenderer(): ResolvedRenderer {
		if (visibilityOverride === false) {
			return {
				protocol: "none",
				multiplexer: null,
				warning: null,
				warningLevel: "info",
			};
		}
		return resolveRenderer(config.terminals, userConfiguredTerminals, {
			ignoreSsh: visibilityOverride === true,
		});
	}

	function installFooter(ctx: any) {
		ctx.ui.setFooter((tui: any, _theme: any, footerData: any) => {
			footerDataRef = footerData;
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render() {
					return [];
				},
			};
		});
	}

	function installWidget(ctx: any) {
		ctx.ui.setWidget(
			"emote",
			createWidgetFactory({
				animator,
				config,
				pi,
				getCtxRef: () => ctxRef,
				getCurrentEmoteSet: () => currentEmoteSet,
				getFooterData: () => footerDataRef,
				getImageVisible: () => visibilityOverride !== false && lastResolved.protocol !== "none",
				placement: widgetPlacement,
			}),
			{ placement: widgetPlacement },
		);
		widgetActive = true;
	}

	function clearWidget(ctx: any) {
		if (widgetActive) {
			ctx.ui.setWidget("emote", undefined);
			widgetActive = false;
		}
		ctx.ui.setFooter(undefined);
		footerDataRef = null;
	}

	function syncRenderer() {
		const detected = createRendererFromResolved(lastResolved, getInitialSize(config.size));
		if (renderer.constructor === detected.constructor) return;
		renderer.dispose();
		renderer = detected;
		animator.setRenderer(renderer);
	}

	function loadEmoteSet(setName: string) {
		currentEmoteSet = setName;
		syncRenderer();

		const setDir = findEmoteSetDir(setName, extDir, cwd, { fallback: false });
		const emotesConfig = loadEmotesConfig(setDir);
		renderer.loadFrames(setDir, extDir);
		animator.setEmotesConfig(emotesConfig);
	}

	function remountWidgetIfActive() {
		if (!ctxRef?.hasUI || !widgetActive) return;
		installWidget(ctxRef);
	}

	function refreshVisibility(ctx: any, options: { notifyWarning?: boolean } = {}) {
		lastResolved = resolveSessionRenderer();
		syncRenderer();

		if (lastResolved.warning && options.notifyWarning !== false) {
			notify(ctx, lastResolved.warning, lastResolved.warningLevel);
		}

		const wasWidgetActive = widgetActive;
		if (!widgetActive) {
			installFooter(ctx);
			installWidget(ctx);
		}

		loadEmoteSet(currentEmoteSet);
		if (wasWidgetActive) remountWidgetIfActive();
		animator.transitionTo(animator.currentState);
	}

	function getVisibilityStatusMessage(): string {
		const mode =
			visibilityOverride === true
				? "forced on"
				: visibilityOverride === false
					? "forced off"
					: "auto";
		const state =
			visibilityOverride === false || lastResolved.protocol === "none"
				? "image hidden"
				: `image visible via ${lastResolved.protocol}`;
		const detail = lastResolved.warning ? ` — ${lastResolved.warning}` : "";
		return `emote ${state} (${mode})${detail}`;
	}

	pi.registerCommand("emote", {
		description: "Toggle session-local emote visibility override",
		handler: async (args, ctx) => {
			if (!config.enabled) {
				notify(ctx, "[emote] Extension disabled by config.", "warning");
				return;
			}

			try {
				const action = parseEmoteCommandAction(args);
				if (action === "status") {
					notify(ctx, getVisibilityStatusMessage());
					return;
				}

				const currentlyVisible = visibilityOverride !== false && lastResolved.protocol !== "none";
				visibilityOverride = action === "toggle" ? !currentlyVisible : action === "on";
				ctxRef = ctx;
				refreshVisibility(ctx, { notifyWarning: visibilityOverride !== false });
				notify(ctx, getVisibilityStatusMessage());
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	if (!config.enabled) return;

	loadEmoteSet("default");

	function getExplicitEmoteSet(): string | null {
		const value = pi.getFlag(EMOTE_FLAG);
		if (typeof value !== "string") return null;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	function resolveConfiguredEmoteSet(modelId: string): string {
		return getExplicitEmoteSet() ?? resolveEmoteSet(modelId, config.emotes);
	}

	function switchEmoteSetForModel(modelId: string) {
		const setName = resolveConfiguredEmoteSet(modelId);
		if (setName !== currentEmoteSet) {
			loadEmoteSet(setName);
			log(`switchEmoteSet: loaded "${setName}", state="${animator.currentState}"`);
			animator.resetRenderCache();
			if (widgetActive && animator.currentState === "idle") {
				animator.enterIdle();
			} else if (widgetActive) {
				renderer.showRandomFrame(animator.currentState, true);
			}
		}
	}

	function initializeSession(ctx: any, options: { greet?: boolean } = {}) {
		log(`session_start: hasUI=${ctx.hasUI}`);
		if (!ctx.hasUI) return;

		animator.clearAllTimers();
		cwd = ctx.cwd;
		visibilityOverride = null;
		({ config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd));
		setDebug(config.debug || pi.getFlag(DEBUG_EMOTE_FLAG) === true);
		animator.updateConfig(config);
		ctxRef = ctx;

		if (!config.enabled) {
			clearWidget(ctx);
			return;
		}

		const modelId = ctx.model?.id ?? "";
		const setName = resolveConfiguredEmoteSet(modelId);
		log(
			`session_start: model="${modelId}" set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`,
		);
		currentEmoteSet = setName;
		refreshVisibility(ctx);
		if (options.greet !== false) setTimeout(() => animator.transitionTo("hi"), 500);
	}

	// --- Events ---

	pi.on("session_start", async (_event, ctx) => {
		initializeSession(ctx);
	});
	(
		pi as ExtensionAPI & {
			on(event: "session_switch", handler: (_event: unknown, ctx: any) => void): void;
		}
	).on("session_switch", (_event, ctx) => {
		initializeSession(ctx, { greet: false });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		animator.clearAllTimers();
		animator.disposeRenderer();
		if (ctx.hasUI) clearWidget(ctx);
		animator.setTui(null);
		ctxRef = null;
		footerDataRef = null;
	});

	pi.on("model_select", async (event) => {
		if (!widgetActive) return;
		const modelId = event.model?.id ?? "";
		const resolved = resolveConfiguredEmoteSet(modelId);
		log(`model_select: model="${modelId}" resolved="${resolved}" current="${currentEmoteSet}"`);
		switchEmoteSetForModel(modelId);
	});

	pi.on("message_update", async (event) => {
		if (!widgetActive) return;
		if (event.message?.role !== "assistant") return;

		const streamEvent = event.assistantMessageEvent;
		if (!streamEvent) return;

		if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
			if (animator.currentState !== "think") {
				animator.transitionTo("think");
			}
			return;
		}

		if (streamEvent.type === "toolcall_start") {
			const partial = streamEvent.partial;
			const block = partial?.content?.[streamEvent.contentIndex];
			if (block && "name" in block && block.name) {
				animator.transitionTo(toolNameToState(block.name));
			} else {
				animator.transitionTo("tool");
			}
			return;
		}

		if (streamEvent.type !== "text_delta") return;
		const text = streamEvent.delta;
		if (!text) return;

		if (animator.currentState !== "talk") {
			animator.transitionTo("talk");
		}
		animator.onTalkToken(text);
	});

	pi.on("agent_end", async () => {
		if (!widgetActive) return;
		if (animator.currentState === "talk") {
			animator.endTalk();
		} else if (
			animator.currentState !== "idle" &&
			animator.currentState !== "hi" &&
			animator.currentState !== "compact"
		) {
			animator.transitionTo("idle");
		}
	});

	pi.on("tool_execution_start", async (event) => {
		if (!widgetActive) return;
		animator.transitionTo(toolNameToState(event.toolName));
	});

	pi.on("tool_execution_end", async (event) => {
		if (!widgetActive) return;
		if (event.toolName === "bash" && event.isError) {
			animator.setHoldNextState("read");
			animator.transitionTo("failure");
		} else {
			animator.transitionTo("read");
		}
	});

	pi.on("session_before_compact", async () => {
		if (!widgetActive) return;
		animator.transitionTo("compact");
	});

	pi.on("session_compact", async () => {
		if (!widgetActive) return;
		animator.transitionTo("idle");
	});
}
