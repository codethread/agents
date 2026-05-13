import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	getThemeNameForMode,
	getThemeSentinelPath,
	parseThemeMode,
	resolveThemeMode,
} from "./theme.js";

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

describe("getThemeNameForMode", () => {
	it("maps sentinel modes to package theme names", () => {
		expect(getThemeNameForMode("light")).toBe("rose-pine-dawn");
		expect(getThemeNameForMode("dark")).toBe("rose-pine-moon");
	});
});
