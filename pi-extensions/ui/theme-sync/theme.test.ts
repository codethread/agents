import * as os from "node:os";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildRosePineTheme,
	getThemeSentinelPath,
	parseThemeMode,
	resolveThemeMode,
} from "./theme.js";

const themeDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../pi-themes");

describe("getThemeSentinelPath", () => {
	it("uses XDG_STATE_HOME when present", () => {
		expect(getThemeSentinelPath({ XDG_STATE_HOME: "/tmp/pi-state" })).toBe(
			"/tmp/pi-state/color-theme",
		);
	});

	it("falls back to HOME/.local/state", () => {
		const home = path.join(os.tmpdir(), "pi-theme-home");
		expect(getThemeSentinelPath({ HOME: home })).toBe(
			path.join(home, ".local", "state", "color-theme"),
		);
	});
});

describe("parseThemeMode", () => {
	it("accepts light and dark", () => {
		expect(parseThemeMode("light\n")).toBe("light");
		expect(parseThemeMode(" dark ")).toBe("dark");
	});

	it("rejects anything else", () => {
		expect(parseThemeMode("moon")).toBeUndefined();
	});
});

describe("resolveThemeMode", () => {
	it("returns undefined when the sentinel is missing", () => {
		expect(resolveThemeMode("/definitely/missing/pi-color-theme")).toBeUndefined();
	});
});

describe("buildRosePineTheme", () => {
	it("loads the dawn palette as runtime rose-pine", () => {
		const theme = buildRosePineTheme(themeDir, "light", "truecolor");

		expect(theme.name).toBe("rose-pine");
		expect(theme.getFgAnsi("accent")).toBe("\u001b[38;2;184;92;88m");
		expect(theme.getBgAnsi("userMessageBg")).toBe("\u001b[48;2;244;237;232m");
	});

	it("loads the moon palette as runtime rose-pine", () => {
		const theme = buildRosePineTheme(themeDir, "dark", "truecolor");

		expect(theme.name).toBe("rose-pine");
		expect(theme.getFgAnsi("accent")).toBe("\u001b[38;2;196;167;231m");
		expect(theme.getBgAnsi("userMessageBg")).toBe("\u001b[48;2;47;44;71m");
	});
});
