import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATE_ENTRY_TYPE = "timeline-timestamps";
const TOOL_CALL_ENTRY_TYPE = "timeline-timestamps-tool-call";
const STATUS_KEY = "timeline-timestamps";

type PersistedStateEntry = {
	data?: {
		enabled?: boolean;
	};
};

function getPersistedEnabled(ctx: ExtensionContext): boolean {
	const entry = ctx.sessionManager
		.getBranch()
		.filter(
			(item: { type: string; customType?: string }) =>
				item.type === "custom" && item.customType === STATE_ENTRY_TYPE,
		)
		.pop() as PersistedStateEntry | undefined;

	return entry?.data?.enabled === true;
}

function notify(ctx: ExtensionContext, message: string) {
	if (ctx.hasUI) {
		ctx.ui.notify(message, "info");
		return;
	}
	process.stdout.write(`${message}\n`);
}

function updateStatus(ctx: ExtensionContext, enabled: boolean) {
	ctx.ui.setStatus(STATUS_KEY, enabled ? "on" : undefined);
}

function resolveNextEnabled(args: string, current: boolean): boolean {
	const normalized = args.trim().toLowerCase();
	if (!normalized || normalized === "toggle") return !current;
	if (["on", "true", "1", "enable", "enabled"].includes(normalized)) return true;
	if (["off", "false", "0", "disable", "disabled"].includes(normalized)) return false;
	if (["status", "show"].includes(normalized)) return current;
	throw new Error("Usage: /timestamp-toggle [toggle|on|off|status]");
}

function summarizeToolCall(toolName: string, args: Record<string, unknown>): string | undefined {
	switch (toolName) {
		case "bash": {
			const command = typeof args.command === "string" ? args.command.trim() : "";
			return command.split("\n")[0] || undefined;
		}
		case "read":
		case "edit":
		case "write": {
			return typeof args.path === "string" ? args.path : undefined;
		}
		default: {
			for (const value of Object.values(args)) {
				if (typeof value !== "string") continue;
				const firstLine = value.trim().split("\n")[0];
				if (firstLine) return firstLine;
			}
			return undefined;
		}
	}
}

export default function timelineTimestampsExtension(pi: ExtensionAPI) {
	let enabled = false;

	function setEnabled(ctx: ExtensionContext, nextEnabled: boolean, persist = true) {
		enabled = nextEnabled;
		updateStatus(ctx, enabled);
		if (persist) pi.appendEntry(STATE_ENTRY_TYPE, { enabled });
	}

	pi.registerCommand("timestamp-toggle", {
		description: "Toggle footer timestamps for recent tool events",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const nextEnabled = resolveNextEnabled(args, enabled);
				setEnabled(ctx, nextEnabled);
				notify(ctx, `timeline timestamps ${nextEnabled ? "enabled" : "disabled"}`);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : String(error));
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		setEnabled(ctx, getPersistedEnabled(ctx), false);
	});

	pi.on("tool_execution_start", async (event) => {
		pi.appendEntry(TOOL_CALL_ENTRY_TYPE, {
			toolName: event.toolName,
			preview: summarizeToolCall(event.toolName, (event.args ?? {}) as Record<string, unknown>),
		});
	});
}
