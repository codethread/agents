import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	bashToolDefinition,
	editToolDefinition,
	findToolDefinition,
	grepToolDefinition,
	lsToolDefinition,
	readToolDefinition,
	writeToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const builtinDefinitions = {
	bash: bashToolDefinition,
	read: readToolDefinition,
	edit: editToolDefinition,
	write: writeToolDefinition,
	grep: grepToolDefinition,
	find: findToolDefinition,
	ls: lsToolDefinition,
} as const;

function summarizeTool(tool: unknown) {
	const value = tool as Record<string, unknown>;
	return {
		name: typeof value.name === "string" ? value.name : null,
		keys: Object.keys(value).sort(),
		hasPromptSnippetProp: Object.prototype.hasOwnProperty.call(value, "promptSnippet"),
		promptSnippet: value.promptSnippet ?? null,
		hasPromptGuidelinesProp: Object.prototype.hasOwnProperty.call(value, "promptGuidelines"),
		promptGuidelines: value.promptGuidelines ?? null,
		description: value.description ?? null,
		sourceInfo: value.sourceInfo ?? null,
	};
}

function summarizeDefinition(definition: Record<string, unknown>) {
	return {
		keys: Object.keys(definition).sort(),
		hasPromptSnippetProp: Object.prototype.hasOwnProperty.call(definition, "promptSnippet"),
		promptSnippet: definition.promptSnippet ?? null,
		hasPromptGuidelinesProp: Object.prototype.hasOwnProperty.call(definition, "promptGuidelines"),
		promptGuidelines: definition.promptGuidelines ?? null,
		description: definition.description ?? null,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("debug-tool-introspection", {
		description: "Print tool metadata visibility details and exit",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: "probe_tool",
		label: "Probe Tool",
		description: "Custom tool used to probe prompt metadata visibility",
		promptSnippet: "Probe prompt metadata visibility for custom tools",
		promptGuidelines: [
			"Use probe_tool only when debugging which tool prompt metadata Pi exposes to extensions.",
		],
		parameters: Type.Object({
			ping: Type.Optional(Type.String()),
		}),
		async execute() {
			return {
				content: [{ type: "text", text: "probe ok" }],
				details: {},
			};
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!pi.getFlag("debug-tool-introspection")) return;

		const allTools = pi.getAllTools();
		const readTool = allTools.find((tool) => tool.name === "read");
		const probeTool = allTools.find((tool) => tool.name === "probe_tool");
		const report = {
			allToolNames: allTools.map((tool) => tool.name),
			readTool: summarizeTool(readTool),
			probeTool: summarizeTool(probeTool),
			builtinDefinitions: Object.fromEntries(
				Object.entries(builtinDefinitions).map(([name, definition]) => [
					name,
					summarizeDefinition(definition),
				]),
			),
		};

		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		if (ctx.hasUI) ctx.ui.notify("Printed tool introspection report", "info");
		process.exit(0);
	});
}
