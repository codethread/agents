import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ThemeMode = "light" | "dark";

const THEME_NAME_BY_MODE: Record<ThemeMode, string> = {
	light: "rose-pine-dawn",
	dark: "rose-pine-moon",
};

export function getThemeSentinelPath(env: NodeJS.ProcessEnv = process.env): string {
	const xdgStateHome = env.XDG_STATE_HOME?.trim();
	if (xdgStateHome) return path.join(xdgStateHome, "color-theme");

	const home = env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
	return path.join(home, ".local", "state", "color-theme");
}

export function parseThemeMode(value: string): ThemeMode | undefined {
	const normalized = value.trim();
	if (normalized === "light" || normalized === "dark") return normalized;
	return undefined;
}

export function readThemeMode(sentinelPath: string): ThemeMode | undefined {
	try {
		return parseThemeMode(fs.readFileSync(sentinelPath, "utf8"));
	} catch {
		return undefined;
	}
}

export function resolveThemeMode(sentinelPath: string): ThemeMode | undefined {
	return readThemeMode(sentinelPath);
}

export function getThemeNameForMode(mode: ThemeMode): string {
	return THEME_NAME_BY_MODE[mode];
}
