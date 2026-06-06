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

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const widgetPlacement: EmoteWidgetPlacement = "belowEditor";

	pi.registerFlag(DEBUG_EMOTE_FLAG, {
		description: "Write pi-emote debug logs to pi/extensions/ui/emote/debug.log",
		type: "boolean",
		default: false,
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

	if (!config.enabled) return;

	// Emote set state
	let currentEmoteSet = "default";
	let ctxRef: any = null;
	let footerDataRef: any = null;
	let widgetActive = false;
	let lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
	let renderer = createRendererFromResolved(lastResolved, getInitialSize(config.size));

	const animator = new Animator(config, renderer);

	function loadEmoteSet(setName: string) {
		currentEmoteSet = setName;

		// Ensure we're using the capability-based renderer
		const detected = createRendererFromResolved(lastResolved, getInitialSize(config.size));
		if (renderer.constructor !== detected.constructor) {
			renderer = detected;
			animator.setRenderer(renderer);
		}

		const setDir = findEmoteSetDir(setName, extDir, cwd);
		const emotesConfig = loadEmotesConfig(setDir);
		renderer.loadFrames(setDir, extDir);
		animator.setEmotesConfig(emotesConfig);
	}

	loadEmoteSet("default");

	function switchEmoteSetForModel(modelId: string) {
		const setName = resolveEmoteSet(modelId, config.emotes);
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

	// --- Events ---

	pi.on("session_start", async (_event, ctx) => {
		log(`session_start: hasUI=${ctx.hasUI}`);
		if (!ctx.hasUI) return;

		animator.clearAllTimers();
		cwd = ctx.cwd;
		({ config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd));
		setDebug(config.debug || pi.getFlag(DEBUG_EMOTE_FLAG) === true);
		animator.updateConfig(config);

		// Re-create renderer in case terminal capabilities changed
		lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
		renderer = createRendererFromResolved(lastResolved, getInitialSize(config.size));
		animator.setRenderer(renderer);

		if (lastResolved.warning) {
			ctx.ui.notify(lastResolved.warning, lastResolved.warningLevel);
			if (lastResolved.warningLevel === "warning") return;
		}

		ctxRef = ctx;

		if (!config.enabled) return;

		// Resolve emote set for current model
		const modelId = ctx.model?.id ?? "";
		const setName = resolveEmoteSet(modelId, config.emotes);
		log(
			`session_start: model="${modelId}" set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`,
		);
		loadEmoteSet(setName);

		// MVP: move the footer renderer into the emote widget canvas and hide the real footer.
		ctx.ui.setFooter((tui, _theme, footerData) => {
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

		// Create widget
		ctx.ui.setWidget(
			"emote",
			createWidgetFactory({
				animator,
				config,
				pi,
				getCtxRef: () => ctxRef,
				getCurrentEmoteSet: () => currentEmoteSet,
				getFooterData: () => footerDataRef,
				placement: widgetPlacement,
			}),
			{ placement: widgetPlacement },
		);

		widgetActive = true;
		setTimeout(() => animator.transitionTo("hi"), 500);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		animator.clearAllTimers();
		animator.disposeRenderer();
		if (widgetActive && ctx.hasUI) {
			ctx.ui.setWidget("emote", undefined);
			widgetActive = false;
		}
		animator.setTui(null);
		ctx.ui.setFooter(undefined);
		ctxRef = null;
		footerDataRef = null;
	});

	pi.on("model_select", async (event) => {
		if (!widgetActive) return;
		const modelId = event.model?.id ?? "";
		const resolved = resolveEmoteSet(modelId, config.emotes);
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
