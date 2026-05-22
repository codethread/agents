import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { buildProjectStructurePrompt, type ExecLike } from "./snapshot.js";

export const PROJECT_STRUCTURE_MESSAGE_TYPE = "project-structure";
export const INVALIDATING_TOOLS = new Set(["bash", "write"]);

export type ProjectStructureContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui" | "signal">;

export interface ProjectStructureController {
	reset(): void;
	invalidate(): void;
	prime(ctx: ProjectStructureContext): void;
	getPrompt(ctx: ProjectStructureContext): Promise<string | null>;
}

export function renderProjectStructureMessage(_message: unknown, _options: unknown, theme: Theme) {
	return new Text(theme.fg("dim", "Project tree sent to agent"), 1, 0);
}

export function createProjectStructureController(exec: ExecLike): ProjectStructureController {
	let cachedCwd: string | null = null;
	let cachedPromptPromise: Promise<string | null> | null = null;
	const warnedCwds = new Set<string>();

	const invalidate = () => {
		cachedCwd = null;
		cachedPromptPromise = null;
	};

	const getPrompt = (ctx: ProjectStructureContext): Promise<string | null> => {
		const { cwd, hasUI, signal, ui } = ctx;
		if (cachedPromptPromise && cachedCwd === cwd) return cachedPromptPromise;

		cachedCwd = cwd;
		const currentPromise = buildProjectStructurePrompt(cwd, exec, signal).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (!warnedCwds.has(cwd)) {
				warnedCwds.add(cwd);
				if (hasUI) ui.notify(`[project-structure] ${message}`, "warning");
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

export default function projectStructureExtension(pi: ExtensionAPI) {
	let lastSentProjectStructurePrompt: string | null = null;
	const projectStructure = createProjectStructureController((command, args, options) =>
		pi.exec(command, args, options),
	);

	pi.registerMessageRenderer(PROJECT_STRUCTURE_MESSAGE_TYPE, renderProjectStructureMessage);

	pi.on("session_start", async (_event, ctx) => {
		projectStructure.reset();
		lastSentProjectStructurePrompt = null;
		projectStructure.prime(ctx);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const prompt = await projectStructure.getPrompt(ctx);
		if (prompt === null || prompt === lastSentProjectStructurePrompt) return;

		lastSentProjectStructurePrompt = prompt;
		return {
			message: {
				customType: PROJECT_STRUCTURE_MESSAGE_TYPE,
				content: prompt,
				display: true,
			},
		};
	});

	pi.on("tool_execution_end", async (event) => {
		if (INVALIDATING_TOOLS.has(event.toolName)) {
			projectStructure.invalidate();
		}
	});
}
