import type { ResolvedRenderer, TerminalMapping } from "./types.js";
import { log } from "./log.js";

type TerminalName = "tmux" | "kitty" | "unknown";

type ResolveRendererOptions = {
	ignoreSsh?: boolean;
};

function hasSshConnection(): boolean {
	return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

function detectTerminalName(): TerminalName {
	if (process.env.TMUX) return "tmux";
	const term = (process.env.TERM ?? "").toLowerCase();
	const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
	if (process.env.KITTY_WINDOW_ID || term.includes("kitty") || termProgram === "kitty")
		return "kitty";
	return "unknown";
}

export function resolveRenderer(
	terminals: TerminalMapping[],
	userConfiguredTerminals: Set<string>,
	options: ResolveRendererOptions = {},
): ResolvedRenderer {
	if (!options.ignoreSsh && hasSshConnection()) {
		log(`terminal: SSH connection detected; disabling emote renderer`);
		return {
			protocol: "none",
			multiplexer: null,
			warning: "[emote] SSH connection detected; emote widget disabled.",
			warningLevel: "info",
		};
	}

	const name = detectTerminalName();
	log(`terminal: detected "${name}"`);

	const configured = terminals.find((entry) => entry.match === name);
	if (configured) {
		log(
			`terminal: "${name}" → "${configured.render}"${userConfiguredTerminals.has(name) ? " (user configured)" : ""}`,
		);
		return {
			protocol: configured.render,
			multiplexer: name === "tmux" ? "tmux" : null,
			warning: null,
			warningLevel: "warning",
		};
	}

	return {
		protocol: "none",
		multiplexer: null,
		warning: "[emote] Kitty terminal not detected; emote widget disabled.",
		warningLevel: "warning",
	};
}
