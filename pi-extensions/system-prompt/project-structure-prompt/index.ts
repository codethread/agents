import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildProjectStructurePrompt, type ExecLike } from "./snapshot.js";

export const INVALIDATING_TOOLS = new Set(["bash", "write"]);

export type ProjectStructurePromptContext = Pick<
	ExtensionContext,
	"cwd" | "hasUI" | "ui" | "signal"
>;

export interface ProjectStructurePromptController {
	reset(): void;
	invalidate(): void;
	prime(ctx: ProjectStructurePromptContext): void;
	getPrompt(ctx: ProjectStructurePromptContext): Promise<string | null>;
}

export function createProjectStructurePromptController(
	exec: ExecLike,
): ProjectStructurePromptController {
	let cachedCwd: string | null = null;
	let cachedPromptPromise: Promise<string | null> | null = null;
	const warnedCwds = new Set<string>();

	const invalidate = () => {
		cachedCwd = null;
		cachedPromptPromise = null;
	};

	const getPrompt = (ctx: ProjectStructurePromptContext): Promise<string | null> => {
		const { cwd, hasUI, signal, ui } = ctx;
		if (cachedPromptPromise && cachedCwd === cwd) return cachedPromptPromise;

		cachedCwd = cwd;
		const currentPromise = buildProjectStructurePrompt(cwd, exec, signal).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (!warnedCwds.has(cwd)) {
				warnedCwds.add(cwd);
				if (hasUI) ui.notify(`[project-structure-prompt] ${message}`, "warning");
			}
			if (cachedPromptPromise === currentPromise) cachedPromptPromise = null;
			if (cachedCwd === cwd) cachedCwd = null;
			return null;
		});

		cachedPromptPromise = currentPromise;
		return currentPromise;
	};

	return {
		reset() {
			invalidate();
			warnedCwds.clear();
		},
		invalidate,
		prime(ctx) {
			void getPrompt(ctx);
		},
		getPrompt,
	};
}
