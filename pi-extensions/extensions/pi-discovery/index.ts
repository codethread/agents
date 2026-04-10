import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	discoverPiExtensions,
	formatExtensionDiscoveryForPrompt,
	formatExtensionDiscoveryReport,
} from "./lib.js";

export default function piDiscoveryExtension(pi: ExtensionAPI) {
	let cachedCwd: string | null = null;
	let cachedDiscoveryPromise: ReturnType<typeof discoverPiExtensions> | null = null;

	const getDiscovery = (cwd: string) => {
		if (cachedDiscoveryPromise && cachedCwd === cwd) return cachedDiscoveryPromise;

		cachedCwd = cwd;
		const discoveryPromise = discoverPiExtensions(cwd);
		cachedDiscoveryPromise = discoveryPromise.catch((error) => {
			if (cachedDiscoveryPromise === discoveryPromise) {
				cachedDiscoveryPromise = null;
				cachedCwd = null;
			}
			throw error;
		});
		return cachedDiscoveryPromise;
	};

	pi.on("session_start", async (_event, ctx) => {
		void getDiscovery(ctx.cwd);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			const discovery = await getDiscovery(ctx.cwd);
			return {
				systemPrompt: `${event.systemPrompt}${formatExtensionDiscoveryForPrompt(discovery)}`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(`[pi-discovery] ${message}`, "warning");
			return undefined;
		}
	});

	pi.registerCommand("debug-extensions", {
		description: "Send discovered extension information into the conversation",
		handler: async (_args, ctx) => {
			try {
				const discovery = await getDiscovery(ctx.cwd);
				const content = `Here are the currently discovered extensions:\n\n${formatExtensionDiscoveryReport(discovery)}`;

				if (!ctx.isIdle()) {
					pi.sendUserMessage(content, { deliverAs: "followUp" });
					if (ctx.hasUI) ctx.ui.notify("Queued extension debug info as follow-up", "info");
					return;
				}

				pi.sendUserMessage(content);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[pi-discovery] ${message}`, "error");
			}
		},
	});
}
