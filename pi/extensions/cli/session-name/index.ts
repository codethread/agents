import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const SESSION_NAME_FLAG = "name";
export const DEBUG_SESSION_NAME_FLAG = "debug-session-name";

function normalizeSessionName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim();
	return name.length > 0 ? name : undefined;
}

function notify(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function sessionNameExtension(pi: ExtensionAPI) {
	pi.registerFlag(SESSION_NAME_FLAG, {
		description: "Set the session display name shown in /tree and session selectors",
		type: "string",
	});

	pi.registerFlag(DEBUG_SESSION_NAME_FLAG, {
		description: "Print the resolved --name session display name and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		const name = normalizeSessionName(pi.getFlag(SESSION_NAME_FLAG));
		const debug = pi.getFlag(DEBUG_SESSION_NAME_FLAG) === true;

		if (debug) {
			process.stdout.write(`${name ?? ""}\n`);
			process.exit(0);
		}

		if (!name) return;

		pi.setSessionName(name);
		notify(ctx, `Session name: ${name}`, "info");
	});
}
