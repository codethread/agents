import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	appendContextNoteToText,
	discoverPiExtensions,
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
	hasStandalonePiTrigger,
	type PiExtensionDiscovery,
} from "./extension-discovery.js";

export interface PiDiscoveryContextNoteDeps {
	discoverPiExtensions: (cwd: string) => Promise<PiExtensionDiscovery>;
	formatExtensionDiscoveryContextNote: (discovery: PiExtensionDiscovery) => string;
	formatExtensionDiscoveryReport: (discovery: PiExtensionDiscovery) => string;
	hasStandalonePiTrigger: (text: string) => boolean;
	appendContextNoteToText: (text: string, contextNote: string) => string;
}

export interface PiDiscoveryInputEvent {
	text: string;
	source: string;
}

export type PiDiscoveryInputResult = { action: "continue" } | { action: "transform"; text: string };

export interface PiDiscoveryController {
	prime(cwd: string): void;
	transformInput(
		event: PiDiscoveryInputEvent,
		ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">,
	): Promise<PiDiscoveryInputResult>;
	getDebugReport(cwd: string): Promise<string>;
}

const defaultContextNoteDeps: PiDiscoveryContextNoteDeps = {
	discoverPiExtensions,
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
	hasStandalonePiTrigger,
	appendContextNoteToText,
};

export function createPiDiscoveryController(
	deps: PiDiscoveryContextNoteDeps = defaultContextNoteDeps,
): PiDiscoveryController {
	let cachedCwd: string | null = null;
	let cachedDiscoveryPromise: Promise<PiExtensionDiscovery> | null = null;
	let hasInjectedContextNote = false;

	const getDiscovery = (cwd: string) => {
		if (cachedDiscoveryPromise && cachedCwd === cwd) return cachedDiscoveryPromise;

		cachedCwd = cwd;
		const discoveryPromise = deps.discoverPiExtensions(cwd);
		const cachedPromise = discoveryPromise.catch((error) => {
			if (cachedDiscoveryPromise === cachedPromise) {
				cachedDiscoveryPromise = null;
				cachedCwd = null;
			}
			throw error;
		});
		cachedDiscoveryPromise = cachedPromise;
		return cachedPromise;
	};

	return {
		prime(cwd) {
			void getDiscovery(cwd);
		},
		async transformInput(event, ctx) {
			if (event.source === "extension") return { action: "continue" };
			if (hasInjectedContextNote) return { action: "continue" };
			if (!deps.hasStandalonePiTrigger(event.text)) return { action: "continue" };

			try {
				const discovery = await getDiscovery(ctx.cwd);
				hasInjectedContextNote = true;
				return {
					action: "transform",
					text: deps.appendContextNoteToText(
						event.text,
						deps.formatExtensionDiscoveryContextNote(discovery),
					),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[pi-discovery] ${message}`, "warning");
				return { action: "continue" };
			}
		},
		async getDebugReport(cwd) {
			const discovery = await getDiscovery(cwd);
			return deps.formatExtensionDiscoveryReport(discovery);
		},
	};
}
