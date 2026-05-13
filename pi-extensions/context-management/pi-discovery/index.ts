import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiDiscoveryController } from "./context-note.js";

export {
	createPiDiscoveryController,
	type PiDiscoveryContextNoteDeps,
	type PiDiscoveryController,
	type PiDiscoveryInputEvent,
	type PiDiscoveryInputResult,
} from "./context-note.js";

export default function piDiscoveryExtension(pi: ExtensionAPI) {
	const controller = createPiDiscoveryController();

	pi.on("session_start", async (_event, ctx) => {
		controller.prime(ctx.cwd);
	});

	pi.on("input", (event, ctx) => {
		return controller.transformInput(event, ctx);
	});

	pi.registerCommand("debug-extensions", {
		description: "Show discovered extension information in the UI only",
		handler: async (_args, ctx) => {
			try {
				const content = await controller.getDebugReport(ctx.cwd);
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
