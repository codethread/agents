import ms from "ms";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_DELAY_MS = 2 ** 31 - 1;

type ParsedDelay = {
	delayMs: number;
	prompt: string;
};

export function parseDelayArgs(args: string): ParsedDelay {
	const trimmed = args.trim();
	const match = /^(\S+)\s+([\s\S]+)$/.exec(trimmed);
	if (!match) throw new Error("usage: /delay <time> <prompt>");

	const [, durationText, prompt] = match;
	const delayMs = ms(durationText as ms.StringValue);
	if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs <= 0) {
		throw new Error(`invalid delay: ${durationText}`);
	}
	if (delayMs > MAX_DELAY_MS) {
		throw new Error(`delay is too long: ${durationText}`);
	}

	return { delayMs, prompt: prompt.trim() };
}

export function formatDelay(delayMs: number): string {
	return ms(delayMs, { long: true });
}

function pad2(value: number): string {
	return value.toString().padStart(2, "0");
}

function isSameLocalDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

export function formatScheduledTimestamp(target: Date, now = new Date()): string {
	if (isSameLocalDay(target, now)) {
		return `[${pad2(target.getHours())}:${pad2(target.getMinutes())}:${pad2(target.getSeconds())}]`;
	}

	return `[${pad2(target.getMonth() + 1)}:${pad2(target.getDate())}:${pad2(target.getHours())}:${pad2(target.getMinutes())}]`;
}

export default function delayExtension(pi: ExtensionAPI) {
	pi.registerCommand("delay", {
		description: "Send a prompt after a delay, e.g. /delay 5m continue",
		handler: async (args, ctx) => {
			let parsed: ParsedDelay;
			try {
				parsed = parseDelayArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			const { delayMs, prompt } = parsed;
			const scheduledAt = new Date(Date.now() + delayMs);
			ctx.ui.notify(
				`Delayed prompt scheduled for ${formatDelay(delayMs)} from now ${formatScheduledTimestamp(scheduledAt)}`,
				"info",
			);

			setTimeout(() => {
				void (async () => {
					try {
						await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
					} catch (error) {
						ctx.ui.notify(
							`/delay failed to send prompt: ${error instanceof Error ? error.message : String(error)}`,
							"error",
						);
					}
				})();
			}, delayMs).unref();
		},
	});
}
