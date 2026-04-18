import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildProjectStructurePrompt, type ExecLike } from "./snapshot.js";

const DEBUG_FLAG = "debug-project-structure";
const INVALIDATING_TOOLS = new Set(["bash", "write"]);

export default function projectStructurePromptExtension(pi: ExtensionAPI) {
	let cachedCwd: string | null = null;
	let cachedPromptPromise: Promise<string | null> | null = null;
	const warnedCwds = new Set<string>();

	const exec: ExecLike = (command, args, options) => pi.exec(command, args, options);

	const invalidate = () => {
		cachedCwd = null;
		cachedPromptPromise = null;
	};

	const getPrompt = (ctx: ExtensionContext): Promise<string | null> => {
		if (cachedPromptPromise && cachedCwd === ctx.cwd) return cachedPromptPromise;

		cachedCwd = ctx.cwd;
		const currentPromise = buildProjectStructurePrompt(ctx.cwd, exec, ctx.signal).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (!warnedCwds.has(ctx.cwd)) {
				warnedCwds.add(ctx.cwd);
				if (ctx.hasUI) ctx.ui.notify(`[project-structure-prompt] ${message}`, "warning");
			}
			if (cachedPromptPromise === currentPromise) cachedPromptPromise = null;
			if (cachedCwd === ctx.cwd) cachedCwd = null;
			return null;
		});

		cachedPromptPromise = currentPromise;
		return currentPromise;
	};

	pi.registerFlag(DEBUG_FLAG, {
		description: "Print the computed project-structure prompt block and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		invalidate();
		warnedCwds.clear();

		if (pi.getFlag(DEBUG_FLAG) === true) {
			try {
				const prompt = await buildProjectStructurePrompt(ctx.cwd, exec);
				process.stdout.write(`${prompt}\n`);
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[project-structure-prompt] ${message}`, "error");
				process.stderr.write(`${message}\n`);
				process.exit(1);
			}
		}

		void getPrompt(ctx);
	});

	pi.on("tool_execution_end", async (event) => {
		if (INVALIDATING_TOOLS.has(event.toolName)) invalidate();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = await getPrompt(ctx);
		if (!prompt) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${prompt}`,
		};
	});
}
