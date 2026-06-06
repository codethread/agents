import { existsSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function buildShellCommand(invocation: { command: string; args: string[] }): string {
	return [invocation.command, ...invocation.args].map(shellQuote).join(" ");
}

export default function forkOffExtension(pi: ExtensionAPI) {
	pi.registerCommand("fork-off", {
		description: "Open a tmux window with a fork of the current session",
		handler: async (args, ctx) => {
			const queued = !ctx.isIdle();
			if (queued) {
				ctx.ui.notify("/fork-off queued; will open after the current agent turn finishes", "info");
				ctx.ui.setStatus("fork-off", "fork-off queued");
			}

			await ctx.waitForIdle();
			ctx.ui.setStatus("fork-off", undefined);

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("/fork-off requires a persisted session; this session is ephemeral", "error");
				return;
			}

			if (!process.env.TMUX?.trim()) {
				ctx.ui.notify("/fork-off requires tmux; TMUX is not set", "error");
				return;
			}

			const extraArgs = args.trim() ? args.trim().split(/\s+/) : [];
			const invocation = getPiInvocation(["--fork", sessionFile, ...extraArgs]);
			const piCommand = buildShellCommand(invocation);
			const shellCommand = `printf '%s\\n' ${shellQuote(`fork-off: ${piCommand}`)}; ${piCommand}; status=$?; printf '%s\\n' ${shellQuote("fork-off: child pi exited with status $status")}; exec ${process.env.SHELL ? shellQuote(process.env.SHELL) : "$SHELL"}`;
			const tmuxArgs = ["new-window", "-c", ctx.cwd, "sh", "-lc", shellCommand];

			try {
				const result = await pi.exec("tmux", tmuxArgs, { timeout: 5000 });
				if (result.code !== 0) {
					const message =
						result.stderr.trim() || result.stdout.trim() || `tmux exited with code ${result.code}`;
					ctx.ui.notify(`/fork-off failed: ${message}`, "error");
					return;
				}

				ctx.ui.notify("Opened forked pi session in a new tmux window", "info");
			} catch (error) {
				ctx.ui.notify(`/fork-off failed: ${getErrorMessage(error)}`, "error");
			}
		},
	});
}
