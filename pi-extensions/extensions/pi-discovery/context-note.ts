import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

const defaultContextNoteDeps: PiDiscoveryContextNoteDeps = {
	discoverPiExtensions,
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
	hasStandalonePiTrigger,
	appendContextNoteToText,
};

export function registerPiDiscoveryExtension(
	pi: ExtensionAPI,
	deps: PiDiscoveryContextNoteDeps = defaultContextNoteDeps,
) {
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

	pi.on("session_start", async (_event, ctx) => {
		void getDiscovery(ctx.cwd);
	});

	pi.on("input", async (event, ctx) => {
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
	});

	pi.registerCommand("debug-extensions", {
		description: "Show discovered extension information in the UI only",
		handler: async (_args, ctx) => {
			try {
				const discovery = await getDiscovery(ctx.cwd);
				const content = deps.formatExtensionDiscoveryReport(discovery);

				if (ctx.hasUI) {
					ctx.ui.notify(content, "info");
					return;
				}

				process.stdout.write(`${content}\n`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[pi-discovery] ${message}`, "error");
				else process.stderr.write(`[pi-discovery] ${message}\n`);
			}
		},
	});
}
