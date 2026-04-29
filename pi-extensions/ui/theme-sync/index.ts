import * as fs from "node:fs";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	buildRosePineTheme,
	getThemeSentinelPath,
	resolveThemeMode,
	type ThemeMode,
} from "./theme.js";

const EXTENSION_NAME = "theme-sync";
const extensionDir = dirname(fileURLToPath(import.meta.url));
const themeDir = resolve(extensionDir, "../../../pi-themes");

function log(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
	const line = `${EXTENSION_NAME}: ${message}`;
	if (ctx.hasUI) {
		ctx.ui.notify(line, level);
		return;
	}

	const stream = level === "error" ? process.stderr : process.stdout;
	stream.write(`${line}\n`);
}

export default function themeSyncExtension(pi: ExtensionAPI) {
	let watcher: fs.FSWatcher | null = null;
	let syncTimer: ReturnType<typeof setTimeout> | null = null;
	let lastAppliedMode: ThemeMode | null = null;

	const sentinelPath = getThemeSentinelPath();
	const sentinelDir = path.dirname(sentinelPath);
	const sentinelFile = path.basename(sentinelPath);

	function clearWatcher() {
		watcher?.close();
		watcher = null;
		if (syncTimer) {
			clearTimeout(syncTimer);
			syncTimer = null;
		}
	}

	function applyTheme(ctx: ExtensionContext) {
		const mode = resolveThemeMode(sentinelPath);
		if (!mode) {
			return;
		}
		if (mode === lastAppliedMode) return;

		const theme = buildRosePineTheme(themeDir, mode, ctx.ui.theme.getColorMode());
		const result = ctx.ui.setTheme(theme);
		if (!result.success) {
			log(ctx, `failed to apply ${mode} theme: ${result.error ?? "unknown error"}`, "warning");
			return;
		}

		lastAppliedMode = mode;
	}

	function scheduleApplyTheme(ctx: ExtensionContext) {
		if (syncTimer) clearTimeout(syncTimer);
		syncTimer = setTimeout(() => {
			syncTimer = null;
			applyTheme(ctx);
		}, 50);
	}

	function startWatcher(ctx: ExtensionContext) {
		clearWatcher();
		fs.mkdirSync(sentinelDir, { recursive: true });

		watcher = fs.watch(sentinelDir, (_eventType, filename) => {
			if (filename && filename.toString() !== sentinelFile) return;
			scheduleApplyTheme(ctx);
		});
		watcher.on("error", (error) => {
			const message = error instanceof Error ? error.message : String(error);
			log(ctx, `watch error for ${sentinelPath}: ${message}`, "warning");
			clearWatcher();
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		lastAppliedMode = null;
		if (!ctx.hasUI) return;

		const baseThemeResult = ctx.ui.setTheme("rose-pine");
		if (!baseThemeResult.success) {
			log(
				ctx,
				`failed to select base rose-pine theme: ${baseThemeResult.error ?? "unknown error"}`,
				"warning",
			);
		}

		applyTheme(ctx);

		try {
			startWatcher(ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(ctx, `failed to watch ${sentinelPath}: ${message}`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		clearWatcher();
	});
}
