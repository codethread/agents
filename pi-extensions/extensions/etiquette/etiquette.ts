export function isSubagentRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.PI_SUBAGENT?.trim() === "1";
}

export function isOpusModelId(modelId: string | null | undefined): boolean {
	if (!modelId) return false;
	return modelId.toLowerCase().includes("opus");
}

export function shouldExposeEtiquetteTool(
	modelId: string | null | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return !isSubagentRuntime(env) && !isOpusModelId(modelId);
}

export const ETIQUETTE_COMPACTION_LINE_THRESHOLD = 50;
export const ETIQUETTE_CHILD_MODEL = "anthropic/claude-sonnet-4-6:high";
export const ETIQUETTE_CHILD_SYSTEM_PROMPT = [
	"You are an information editor",
	"Please take the prompt given to you and return it back but as concise as possible.",
	"The input is coming from an llm prone to talk, and your task is to compact this down for a user.",
	"Remember the user's most precious asset is their time and limited brain capacity - which cannot be extended.",
].join("\n");

export function countMessageLines(message: string): number {
	return message.split(/\r?\n/u).length;
}

export function shouldRunEtiquetteCompaction(
	message: string,
	threshold: number = ETIQUETTE_COMPACTION_LINE_THRESHOLD,
): boolean {
	return countMessageLines(message) > threshold;
}

export function buildEtiquettePrompt(message: string): string {
	return [
		"Compact the following drafted user-facing message.",
		"Return only the compacted message text. No commentary, no quotes, no explanations.",
		"",
		"<message>",
		message,
		"</message>",
	].join("\n");
}

export function buildEtiquetteArgs(
	message: string,
	model: string = ETIQUETTE_CHILD_MODEL,
	systemPromptPath?: string,
): string[] {
	const args = [
		"--print",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-tools",
		"--no-context-files",
		"--model",
		model,
	];
	if (systemPromptPath) {
		args.push("--system-prompt", systemPromptPath);
	}
	args.push(buildEtiquettePrompt(message));
	return args;
}

export function extractFinalAssistantTextFromPrintOutput(output: string): string {
	return output.trim();
}
