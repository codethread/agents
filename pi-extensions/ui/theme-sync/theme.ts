import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Theme } from "@earendil-works/pi-coding-agent";

export type ThemeMode = "light" | "dark";

type ThemeColorValue = string | number;

type ThemeDefinition = {
	vars?: Record<string, ThemeColorValue>;
	colors: Record<string, ThemeColorValue>;
};

type ColorMode = ReturnType<Theme["getColorMode"]>;

const THEME_FILE_BY_MODE: Record<ThemeMode, string> = {
	light: "rose-pine-dawn.json",
	dark: "rose-pine-moon.json",
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

function resolveThemeValue(
	value: ThemeColorValue | undefined,
	vars: Record<string, ThemeColorValue>,
): ThemeColorValue {
	if (value === undefined) throw new Error("Missing theme color value");
	if (typeof value !== "string") return value;
	if (value === "" || value.startsWith("#")) return value;

	const resolved = vars[value];
	if (resolved === undefined) throw new Error(`Unknown theme variable: ${value}`);
	return resolved;
}

function readThemeDefinition(themeDir: string, mode: ThemeMode): ThemeDefinition {
	const filePath = path.join(themeDir, THEME_FILE_BY_MODE[mode]);
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as ThemeDefinition;
}

export function buildRosePineTheme(themeDir: string, mode: ThemeMode, colorMode: ColorMode): Theme {
	const definition = readThemeDefinition(themeDir, mode);
	const vars = definition.vars ?? {};

	const fgColors: Record<string, ThemeColorValue> = {};
	const bgColors: Record<string, ThemeColorValue> = {};

	for (const [key, value] of Object.entries(definition.colors)) {
		const resolved = resolveThemeValue(value, vars);
		if (key.endsWith("Bg")) {
			bgColors[key] = resolved;
		} else {
			fgColors[key] = resolved;
		}
	}

	return new Theme(
		fgColors as ConstructorParameters<typeof Theme>[0],
		bgColors as ConstructorParameters<typeof Theme>[1],
		colorMode,
		{ name: "rose-pine" },
	);
}
