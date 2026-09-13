import type { ToolInfo } from "@earendil-works/pi-coding-agent";

const DEBUG_TOOLS_FLAG = "--debug-tools";

type DebugToolInfo = Pick<ToolInfo, "name" | "description" | "parameters" | "promptGuidelines">;

export type DebugToolReportInput = {
	tools: DebugToolInfo[];
	activeTools: readonly string[];
	requestedTools?: readonly string[];
	model?: { provider?: string; id?: string } | null;
};

export function parseDebugToolNames(argv: readonly string[]): string[] | undefined {
	let rawValue: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === DEBUG_TOOLS_FLAG) {
			const next = argv[index + 1];
			if (next !== undefined && !next.startsWith("-")) {
				rawValue = next;
				index += 1;
			} else {
				rawValue = undefined;
			}
			continue;
		}
		if (arg.startsWith(`${DEBUG_TOOLS_FLAG}=`)) {
			rawValue = arg.slice(DEBUG_TOOLS_FLAG.length + 1);
		}
	}

	if (rawValue === undefined || rawValue.trim() === "") return undefined;

	const names = rawValue.split(",").map((name) => name.trim());
	if (names.some((name) => name.length === 0)) {
		throw new Error("--debug-tools expects a comma-separated list of non-empty tool names.");
	}
	return [...new Set(names)];
}

function selectTools(
	tools: DebugToolInfo[],
	requestedTools: readonly string[] | undefined,
): DebugToolInfo[] {
	if (!requestedTools) return tools;

	const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
	const unknownTools = requestedTools.filter((name) => !toolsByName.has(name));
	if (unknownTools.length > 0) {
		throw new Error(
			`Unknown tool${unknownTools.length === 1 ? "" : "s"}: ${unknownTools.join(", ")}. Available tools: ${tools.map((tool) => tool.name).join(", ")}.`,
		);
	}
	return requestedTools.map((name) => toolsByName.get(name)!);
}

function renderPromptContribution(tool: DebugToolInfo, active: boolean): string {
	if (!active) return "(not present; tool is inactive)";
	return [
		`- \`${tool.name}\``,
		...(tool.promptGuidelines ?? []).map((guideline) => `  - ${guideline.trim()}`),
	].join("\n");
}

function renderTool(tool: DebugToolInfo, activeTools: Set<string>): string {
	const active = activeTools.has(tool.name);
	const modelDefinition = {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
	return [
		`## \`${tool.name}\``,
		`Status: ${active ? "active" : "inactive"}`,
		"",
		"### System prompt contribution (approximate)",
		"",
		"```text",
		renderPromptContribution(tool, active),
		"```",
		"",
		"### Model tool definition (provider-neutral)",
		"",
		"```json",
		JSON.stringify(modelDefinition, null, "\t"),
		"```",
	].join("\n");
}

export function formatDebugToolReport({
	tools,
	activeTools,
	requestedTools,
	model,
}: DebugToolReportInput): string {
	const selectedTools = selectTools(tools, requestedTools);
	const activeToolSet = new Set(activeTools);
	const modelName = [model?.provider, model?.id].filter(Boolean).join("/") || "unknown";
	const scope = requestedTools ? requestedTools.join(", ") : "all registered tools";
	return [
		"# Tool debug report",
		"",
		`Model: ${modelName}`,
		`Scope: ${scope}`,
		"",
		"System-prompt entries are reconstructed from active status and registered prompt guidelines. Model definitions are shown before provider-specific adapter transformations.",
		...(selectedTools.length > 0
			? ["", selectedTools.map((tool) => renderTool(tool, activeToolSet)).join("\n\n")]
			: ["", "(no tools registered)"]),
	].join("\n");
}
