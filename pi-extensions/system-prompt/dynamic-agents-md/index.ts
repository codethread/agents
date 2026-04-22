import { renderNearestTemplate, type DynamicAgentsTemplateVars } from "./parser.js";

export type { DynamicAgentsTemplateVars } from "./parser.js";

export interface DynamicAgentsPromptContext {
	cwd: string;
	hasUI: boolean;
	tools?: string[];
	model?: {
		provider?: string;
		id?: string;
	} | null;
}

function isTemplateVarsObject(value: unknown): value is DynamicAgentsTemplateVars {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSubagentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_SUBAGENT?.trim() === "1";
}

export function parseDebugPromptOverrides(argv: string[]): {
	overrides: DynamicAgentsTemplateVars | null;
	error: string | null;
} {
	let rawValue: string | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--debug-prompt") {
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
				rawValue = next;
				i++;
			}
			continue;
		}

		if (arg.startsWith("--debug-prompt=")) {
			rawValue = arg.slice("--debug-prompt=".length);
		}
	}

	if (rawValue === undefined) {
		return { overrides: null, error: null };
	}

	const trimmedRawValue = rawValue.trim();
	if (!trimmedRawValue.startsWith("{")) {
		return { overrides: null, error: null };
	}

	try {
		const parsed = JSON.parse(trimmedRawValue);
		if (!isTemplateVarsObject(parsed)) {
			return {
				overrides: null,
				error:
					'--debug-prompt value must be a JSON object, e.g. --debug-prompt \'{"model":"claude-sonnet"}\'',
			};
		}

		return { overrides: parsed, error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			overrides: null,
			error: `Invalid --debug-prompt JSON: ${message}`,
		};
	}
}

export function getTemplateVars(
	ctx: DynamicAgentsPromptContext,
	overrides?: DynamicAgentsTemplateVars | null,
): DynamicAgentsTemplateVars {
	const isSubagent = isSubagentRuntime();
	return {
		provider: ctx.model?.provider,
		model: ctx.model?.id,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		isMainAgent: !isSubagent,
		isSubagent,
		...process.env,
		tools: ctx.tools ?? [],
		...overrides,
	};
}

export async function renderDynamicAgentsPrompt(
	ctx: DynamicAgentsPromptContext,
	overrides?: DynamicAgentsTemplateVars | null,
): Promise<string | null> {
	const rendered = await renderNearestTemplate(ctx.cwd, getTemplateVars(ctx, overrides));
	return rendered?.renderedPrompt ?? null;
}
