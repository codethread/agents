import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { inspectRexWindow, scheduleRexClose, type RexPlan, type RexWindow } from "./rex.js";

interface TerminationServices {
	/** Identify only the Rex tab containing this Pi process. */
	inspectRexWindow(): Promise<RexPlan>;
	/** Arrange tab closure after process exit; return the cleanup log path. */
	scheduleRexClose(window: RexWindow): Promise<string>;
}

export default function selfTerminateExtension(pi: ExtensionAPI) {
	registerSelfTerminate(pi, {
		inspectRexWindow: () => inspectRexWindow(process.env, process.pid),
		scheduleRexClose,
	});
}

export function registerSelfTerminate(pi: ExtensionAPI, services: TerminationServices) {
	pi.registerFlag("debug-self-terminate", {
		description: "Dry-run self-terminate calls without shutting down or closing Rex",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: "self-terminate",
		label: "Self Terminate",
		description:
			"Gracefully exit this session and close its Rex tab. Only when directly authorized by the user; never infer permission.",
		executionMode: "sequential",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx) {
			const rex = await services.inspectRexWindow();
			signal?.throwIfAborted();
			if (pi.getFlag("debug-self-terminate") === true) {
				return {
					content: [{ type: "text" as const, text: `Dry run: ${JSON.stringify(rex)}` }],
					details: { rex },
				};
			}

			let logPath: string | undefined;
			let message: string;
			if (rex.kind === "close") {
				logPath = await services.scheduleRexClose(rex.window);
				message = `Graceful shutdown requested. Rex tab will close after Pi exits. Cleanup log: ${logPath}`;
			} else {
				message = `Graceful shutdown requested. Rex tab unchanged: ${rex.reason}`;
			}
			ctx.shutdown();
			return {
				content: [{ type: "text" as const, text: message }],
				details: { rex, logPath },
				terminate: true,
			};
		},
	});
}
