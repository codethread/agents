import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { showDebugMessage } from "../../../pi-extensions/components/debug-message/index.js";
import { discoverPiExtensions, type PiExtensionDiscovery } from "./discovery.js";
import {
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
} from "./rendering.js";

const DEBUG_PI_INTERNALS_FLAG = "debug-pi-internals";

function summarizeDiscovery(discovery: PiExtensionDiscovery): string {
	const roots = [...new Set(discovery.extensions.map((extension) => extension.baseDir))];
	return [
		`Pi source: ${discovery.piSource.inspectPackageDir}`,
		`Project config: ${discovery.projectConfigDir}`,
		`Extensions: ${discovery.extensions.length} enabled`,
		`Extension roots: ${roots.join(", ")}`,
	].join("\n");
}

function isDiscoveryDetails(details: unknown): details is PiExtensionDiscovery {
	return typeof details === "object" && details !== null && "extensions" in details;
}

export default function piInternalsExtension(pi: ExtensionAPI) {
	pi.registerFlag(DEBUG_PI_INTERNALS_FLAG, {
		description: "Print Pi internals discovery report and exit",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: "pi-internals",
		label: "Pi Internals",
		description:
			"Print Pi runtime, source/documentation, settings, and enabled extension paths. Use if the user asks about Pi/pi, or building a Pi extension or Skill",
		promptSnippet:
			"Print Pi runtime/source/settings/enabled-extension paths when Pi internals are relevant.",
		promptGuidelines: [
			"Use pi-internals when the user asks about Pi itself, Pi runtime behavior, installed/enabled extensions, Pi SDK docs, themes, skills, prompt templates, TUI, or custom tools.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const discovery = await discoverPiExtensions(ctx.cwd);
				const text = formatExtensionDiscoveryContextNote(discovery);
				return {
					content: [{ type: "text" as const, text }],
					details: discovery,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text" as const, text: `[pi-internals] ${message}` }],
					details: {},
					isError: true,
				};
			}
		},

		renderResult(result, _options, theme, context) {
			if (context.isError) {
				const first = result.content?.[0];
				const message = first?.type === "text" ? first.text : "pi-internals failed";
				return new Text(theme.fg("error", message), 0, 0);
			}

			if (!isDiscoveryDetails(result.details)) {
				return new Text(theme.fg("toolOutput", "Pi internals loaded."), 0, 0);
			}

			return new Text(theme.fg("toolOutput", summarizeDiscovery(result.details)), 0, 0);
		},
	});

	pi.registerCommand("debug-pi-internals", {
		description: "Show discovered Pi internals in a debug panel",
		handler: async (_args, ctx) => {
			try {
				const discovery = await discoverPiExtensions(ctx.cwd);
				const content = formatExtensionDiscoveryReport(discovery);
				if (ctx.hasUI) {
					await showDebugMessage(ctx, {
						headingText: "Pi Internals",
						subheadingText: "runtime, settings, docs, and enabled extensions",
						markdownBody: content,
						sendMarkdownToAgent: async (markdownBody) => {
							await pi.sendUserMessage(markdownBody);
						},
					});
					return;
				}

				process.stdout.write(`${content}\n`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`[pi-internals] ${message}`, "error");
				else process.stderr.write(`[pi-internals] ${message}\n`);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag(DEBUG_PI_INTERNALS_FLAG) !== true) return;
		try {
			const discovery = await discoverPiExtensions(ctx.cwd);
			process.stdout.write(`${formatExtensionDiscoveryReport(discovery)}\n`);
			process.exit(0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[pi-internals] ${message}\n`);
			process.exit(1);
		}
	});
}
