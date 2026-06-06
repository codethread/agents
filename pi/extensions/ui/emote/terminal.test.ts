import { afterEach, describe, expect, it } from "vitest";

import { resolveRenderer } from "./terminal.js";
import type { TerminalMapping } from "./types.js";

const terminals: TerminalMapping[] = [
	{ match: "kitty", render: "kitty" },
	{ match: "tmux", render: "kitty-unicode" },
];

const originalEnv = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
	process.env = { ...originalEnv, ...env };
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
	}
}

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("resolveRenderer", () => {
	it("disables the emote renderer when an SSH connection is present", () => {
		setEnv({
			SSH_CONNECTION: "client 123 host 22",
			KITTY_WINDOW_ID: "1",
			TERM: "xterm-kitty",
			TMUX: undefined,
		});

		expect(resolveRenderer(terminals, new Set())).toEqual({
			protocol: "none",
			multiplexer: null,
			warning: "[emote] SSH connection detected; emote widget disabled.",
			warningLevel: "info",
		});
	});

	it("still resolves kitty when SSH is absent", () => {
		setEnv({
			SSH_CONNECTION: undefined,
			SSH_CLIENT: undefined,
			SSH_TTY: undefined,
			TMUX: undefined,
			KITTY_WINDOW_ID: "1",
		});

		expect(resolveRenderer(terminals, new Set())).toEqual({
			protocol: "kitty",
			multiplexer: null,
			warning: null,
			warningLevel: "warning",
		});
	});
});
