import type {
	BuildSystemPromptOptions,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { showDebugMessage } from "../components/debug-message/index.js";
import { MILLSTRAND_IDENTITY_CONTEXT_EVENT } from "../shared/millstrand-identity.js";
import { discoverProjectRules, getUnconditionalRules } from "../shared/project-rules.js";
import {
	DEBUG_MILLSTRAND_IDENTITY_FLAG,
	formatNativeIdentityState,
	getNativeIdentityInputs,
	MILLSTRAND_IDENTITY_FLAG,
	MILLSTRAND_WORKSPACE_FLAG,
	nativeIdentityModel,
	resolveNativeIdentity,
	type NativeIdentityState,
} from "./native-identity.js";
import {
	acknowledgeManagedGuidance,
	DEBUG_MANAGED_GUIDANCE_FLAG,
	failManagedGuidance,
	fetchManagedGuidance,
	formatManagedGuidanceDebug,
	renderManagedGuidance,
	stageManagedPiGuidanceSelection,
	ManagedGuidanceAdapterError,
	type ManagedGuidanceBundle,
	type ManagedPiSelection,
} from "./managed-guidance.js";
import {
	DEFAULT_PERSONA,
	buildSystemPrompt,
	loadClaudeLocalContextFiles,
} from "./prompt-builder.js";
import { parseDebugPromptOverrides, renderDynamicPrompt, type TemplateVars } from "./templates.js";
import { formatDebugToolReport, parseDebugToolNames } from "./tool-report.js";

const DEBUG_PROMPT_FLAG = "debug-prompt";
const DEBUG_TOOLS_FLAG = "debug-tools";

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
type ToolPromptMetadata = {
	promptGuidelines: string[];
};

type BeforeAgentStartEvent = {
	systemPrompt: string;
	systemPromptOptions?: Partial<BuildSystemPromptOptions>;
};

function trimOuterEmptyLines(text: string): string {
	return text.trim();
}

type OwnedSystemPromptOptions = Partial<BuildSystemPromptOptions> & {
	cwd: string;
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	promptGuidelines: string[];
};

function getOwnedSystemPromptOptions(event: BeforeAgentStartEvent): OwnedSystemPromptOptions {
	const options = event.systemPromptOptions;
	if (!options)
		throw new Error("Pi did not provide systemPromptOptions for owned prompt rendering.");
	if (!options.cwd) throw new Error("Pi did not provide systemPromptOptions.cwd.");
	if (!options.selectedTools)
		throw new Error("Pi did not provide systemPromptOptions.selectedTools.");
	if (!options.toolSnippets)
		throw new Error("Pi did not provide systemPromptOptions.toolSnippets.");
	if (!options.promptGuidelines) {
		throw new Error("Pi did not provide systemPromptOptions.promptGuidelines.");
	}
	return options as OwnedSystemPromptOptions;
}

function notify(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function mentionsTool(guideline: string, toolName: string): boolean {
	return new RegExp(
		`(^|[^a-z0-9_\\-])${toolName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z0-9_\\-]|$)`,
		"i",
	).test(guideline);
}

function groupToolGuidelines(
	selectedTools: string[],
	promptGuidelines: string[],
	metadata: Map<string, ToolPromptMetadata>,
): Record<string, string[]> {
	const grouped: Record<string, string[]> = {};
	const claimed = new Set<string>();
	const addGuideline = (toolName: string, guideline: string) => {
		const normalized = guideline.trim();
		if (!normalized) return;
		grouped[toolName] ??= [];
		if (!grouped[toolName].includes(normalized)) grouped[toolName].push(normalized);
		claimed.add(normalized);
	};

	for (const toolName of selectedTools) {
		for (const guideline of metadata.get(toolName)?.promptGuidelines ?? []) {
			addGuideline(toolName, guideline);
		}
	}

	let currentTool: string | undefined;
	for (const guideline of promptGuidelines) {
		const normalized = guideline.trim();
		if (!normalized) continue;
		const matchingTool = selectedTools.find((toolName) => mentionsTool(normalized, toolName));
		currentTool = matchingTool ?? currentTool;
		if (currentTool && !claimed.has(normalized)) addGuideline(currentTool, normalized);
	}

	return grouped;
}

export default function systemPromptExtension(pi: ExtensionAPI) {
	let printPromptOnNextTurn = false;
	let dynamicPrompt: string | null = null;
	let lastMaterializedPrompt: string | null = null;
	let nativeIdentityState: NativeIdentityState = { status: "pending" };
	let managedSelection: ManagedPiSelection = { kind: "unmanaged" };
	let managedBundle: ManagedGuidanceBundle | null = null;
	let managedError: string | undefined;
	let managedTurnBlocked = false;
	const toolPromptMetadata = new Map<string, ToolPromptMetadata>();
	const registerTool = pi.registerTool.bind(pi);
	pi.registerTool = ((definition: ToolDefinition) => {
		toolPromptMetadata.set(definition.name, {
			promptGuidelines: definition.promptGuidelines ?? [],
		});
		registerTool(definition);
	}) as ExtensionAPI["registerTool"];

	pi.registerFlag(DEBUG_PROMPT_FLAG, {
		description:
			"Print the current effective system prompt and exit (optionally with a JSON override arg)",
		type: "boolean",
		default: false,
	});
	pi.registerFlag(DEBUG_TOOLS_FLAG, {
		description:
			"Print registered tool prompt contributions and model-facing schemas, optionally filtered by a comma-separated list",
		type: "boolean",
		default: false,
	});
	pi.registerFlag(MILLSTRAND_IDENTITY_FLAG, {
		description: "Assert an existing Millstrand identity for this exact native Pi session",
		type: "string",
	});
	pi.registerFlag(MILLSTRAND_WORKSPACE_FLAG, {
		description: "Use an explicit Millstrand workspace for native Pi identity resolution",
		type: "string",
	});
	pi.registerFlag(DEBUG_MILLSTRAND_IDENTITY_FLAG, {
		description: "Resolve and print native Pi Millstrand identity state, then exit",
		type: "boolean",
		default: false,
	});
	pi.registerFlag(DEBUG_MANAGED_GUIDANCE_FLAG, {
		description: "Validate and print managed native-v1 guidance handoff, then exit",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("debug-prompt", {
		description: "Show the last materialized effective system prompt",
		handler: async (_args, ctx) => {
			const prompt = lastMaterializedPrompt;
			if (!prompt) {
				const message =
					"No materialized system prompt yet. Send a message first, then rerun /debug-prompt.";
				if (!ctx.hasUI) process.stderr.write(`${message}\n`);
				else notify(ctx, message, "warning");
				return;
			}

			if (!ctx.hasUI) {
				process.stdout.write(`${prompt}\n`);
				return;
			}

			await showDebugMessage(ctx, {
				headingText: "Debug Prompt",
				subheadingText: "last materialized effective prompt",
				markdownBody: prompt,
				sendMarkdownToAgent: async () => {
					await pi.sendUserMessage(prompt);
				},
			});
		},
	});

	pi.registerCommand("debug-millstrand-identity", {
		description: "Show native Pi Millstrand identity state",
		handler: async (_args, ctx) => {
			const report = formatNativeIdentityState(nativeIdentityState, ctx.cwd);
			if (!ctx.hasUI) {
				process.stdout.write(`${report}\n`);
				return;
			}
			await showDebugMessage(ctx, {
				headingText: "Millstrand Identity",
				subheadingText: "native Pi session binding",
				markdownBody: `\`\`\`json\n${report}\n\`\`\``,
				sendMarkdownToAgent: async (markdownBody) => {
					await pi.sendUserMessage(markdownBody);
				},
			});
		},
	});

	pi.on("input", () => {
		if (!managedTurnBlocked) return;
		return { action: "handled" };
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!managedTurnBlocked) return;
		ctx.abort();
		return event.payload;
	});

	pi.on("session_shutdown", () => {
		pi.events.emit(MILLSTRAND_IDENTITY_CONTEXT_EVENT, null);
	});

	pi.on("session_start", async (_event, ctx) => {
		printPromptOnNextTurn = false;
		dynamicPrompt = null;
		lastMaterializedPrompt = null;
		nativeIdentityState = { status: "pending" };
		managedSelection = { kind: "unmanaged" };
		managedBundle = null;
		managedError = undefined;
		managedTurnBlocked = false;
		pi.events.emit(MILLSTRAND_IDENTITY_CONTEXT_EVENT, null);

		const wantsToolsDebug = pi.getFlag(DEBUG_TOOLS_FLAG) === true;
		if (wantsToolsDebug) {
			try {
				const requestedTools = parseDebugToolNames(process.argv.slice(2));
				process.stdout.write(
					`${formatDebugToolReport({
						tools: pi.getAllTools(),
						activeTools: pi.getActiveTools(),
						requestedTools,
						model: ctx.model,
					})}\n`,
				);
				process.exit(0);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`${message}\n`);
				process.exit(1);
			}
		}

		const wantsPromptDebug = pi.getFlag(DEBUG_PROMPT_FLAG) === true;
		const wantsIdentityDebug = pi.getFlag(DEBUG_MILLSTRAND_IDENTITY_FLAG) === true;
		let templateOverrides: TemplateVars | null = null;
		if (wantsPromptDebug) {
			const parsedOverrides = parseDebugPromptOverrides(process.argv.slice(2));
			if (parsedOverrides.error) {
				notify(ctx, parsedOverrides.error, "error");
				process.stderr.write(`${parsedOverrides.error}\n`);
				process.exit(1);
			}
			templateOverrides = parsedOverrides.overrides;
		}

		const nativeSessionId = ctx.sessionManager.getSessionId();
		try {
			const stagedSelection = stageManagedPiGuidanceSelection(nativeSessionId, ctx.cwd);
			managedSelection = stagedSelection.selection;
			if (stagedSelection.kind === "rejected") {
				managedError = stagedSelection.message;
				managedTurnBlocked = true;
				if (stagedSelection.receiptRouteTrusted) {
					try {
						await failManagedGuidance(
							stagedSelection.selection,
							nativeSessionId,
							"validation",
							"selection-fence-mismatch",
							stagedSelection.message,
							undefined,
							process.env,
							ctx.signal,
						);
					} catch (failureError) {
						const failureMessage =
							failureError instanceof Error ? failureError.message : String(failureError);
						managedError = `${stagedSelection.message}; failure receipt was not recorded: ${failureMessage}`;
					}
				}
				throw new Error(managedError);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			managedError = message;
			managedTurnBlocked = true;
			notify(ctx, `[millstrand-guidance] ${message}`, "error");
			process.stderr.write(`[millstrand-guidance] ${message}\n`);
			throw error;
		}
		const dynamicPromptPromise = renderDynamicPrompt(
			{
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
				model: ctx.model,
				tools: pi.getActiveTools(),
			},
			templateOverrides,
		).then(
			(value) => ({ status: "fulfilled" as const, value }),
			(reason: unknown) => ({ status: "rejected" as const, reason }),
		);

		if (managedSelection.kind === "native-v1") {
			nativeIdentityState = {
				status: "suppressed",
				reason: "managed native-v1 owns identity and frozen guidance",
				nativeSessionId,
			};
			try {
				managedBundle = await fetchManagedGuidance(
					managedSelection,
					nativeSessionId,
					undefined,
					process.env,
					ctx.signal,
				);
				pi.events.emit(MILLSTRAND_IDENTITY_CONTEXT_EVENT, {
					identity: managedBundle.identity,
					instruction: managedBundle.context["identity-instruction"],
					nativeSessionId,
					workspace: managedBundle.workspace,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const stage = error instanceof ManagedGuidanceAdapterError ? error.stage : "startup";
				managedError = message;
				managedTurnBlocked = true;
				if (!(error instanceof ManagedGuidanceAdapterError) || error.receiptRouteTrusted) {
					try {
						await failManagedGuidance(
							managedSelection,
							nativeSessionId,
							stage,
							`${stage}-failed`,
							message,
							undefined,
							process.env,
							ctx.signal,
						);
					} catch (failureError) {
						const failureMessage =
							failureError instanceof Error ? failureError.message : String(failureError);
						managedError = `${message}; failure receipt was not recorded: ${failureMessage}`;
					}
				}
				notify(ctx, `[millstrand-guidance] ${managedError}`, "error");
				process.stderr.write(`[millstrand-guidance] ${managedError}\n`);
				throw new Error(managedError);
			}
		} else if (managedSelection.kind === "legacy") {
			nativeIdentityState = {
				status: "suppressed",
				reason: "legacy managed run uses its existing prompt transport",
				nativeSessionId,
			};
		} else {
			try {
				const inputs = getNativeIdentityInputs(pi);
				const resolved = await resolveNativeIdentity(pi.exec, {
					cwd: ctx.cwd,
					nativeSessionId,
					model: nativeIdentityModel(ctx),
					thinkingLevel: ctx.thinkingLevel,
					signal: ctx.signal,
					...inputs,
				});
				nativeIdentityState = { status: "bound", ...resolved };
				pi.events.emit(MILLSTRAND_IDENTITY_CONTEXT_EVENT, resolved);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				nativeIdentityState = { status: "error", error: message, nativeSessionId };
				pi.events.emit(MILLSTRAND_IDENTITY_CONTEXT_EVENT, null);
				notify(ctx, `[millstrand-identity] ${message}`, "error");
				process.stderr.write(`[millstrand-identity] ${message}\n`);
			}
		}

		const dynamicPromptResult = await dynamicPromptPromise;
		if (dynamicPromptResult.status === "rejected") {
			if (managedSelection.kind === "native-v1") {
				const message =
					dynamicPromptResult.reason instanceof Error
						? dynamicPromptResult.reason.message
						: String(dynamicPromptResult.reason);
				managedError = message;
				managedTurnBlocked = true;
				try {
					await failManagedGuidance(
						managedSelection,
						nativeSessionId,
						"rendering",
						"dynamic-prompt-failed",
						message,
						undefined,
						process.env,
						ctx.signal,
					);
				} catch (failureError) {
					const failureMessage =
						failureError instanceof Error ? failureError.message : String(failureError);
					managedError = `${message}; failure receipt was not recorded: ${failureMessage}`;
				}
				throw new Error(managedError);
			}
			throw dynamicPromptResult.reason;
		}
		dynamicPrompt = dynamicPromptResult.value;
		if (wantsIdentityDebug) {
			process.stdout.write(`${formatNativeIdentityState(nativeIdentityState, ctx.cwd)}\n`);
			process.exit(nativeIdentityState.status === "error" ? 1 : 0);
		}
		if (!wantsPromptDebug) return;
		printPromptOnNextTurn = true;
		notify(ctx, "Debug prompt mode: send a message to materialize the prompt.", "info");
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const nativeSelection = managedSelection.kind === "native-v1" ? managedSelection : null;
		const nativeSessionId = nativeSelection ? ctx.sessionManager.getSessionId() : "";
		let options: OwnedSystemPromptOptions;
		try {
			options = getOwnedSystemPromptOptions(event);
		} catch (error) {
			if (nativeSelection) {
				const message = error instanceof Error ? error.message : String(error);
				managedError = message;
				managedTurnBlocked = true;
				try {
					await failManagedGuidance(
						nativeSelection,
						nativeSessionId,
						"validation",
						"system-prompt-options-invalid",
						message,
						undefined,
						process.env,
						ctx.signal,
					);
				} catch (failureError) {
					const failureMessage =
						failureError instanceof Error ? failureError.message : String(failureError);
					managedError = `${message}; failure receipt was not recorded: ${failureMessage}`;
				}
				throw new Error(managedError);
			}
			throw error;
		}
		if (nativeSelection && (options.customPrompt?.trim() || options.appendSystemPrompt?.trim())) {
			const message = "native-v1 received a competing Pi system-prompt option";
			managedError = message;
			managedTurnBlocked = true;
			await failManagedGuidance(
				nativeSelection,
				nativeSessionId,
				"validation",
				"competing-prompt-option",
				message,
				undefined,
				process.env,
				ctx.signal,
			);
			throw new Error(message);
		}
		let projectRules: Awaited<ReturnType<typeof discoverProjectRules>>;
		let claudeLocalContextFiles: Awaited<ReturnType<typeof loadClaudeLocalContextFiles>>;
		try {
			[projectRules, claudeLocalContextFiles] = await Promise.all([
				discoverProjectRules(options.cwd, pi.exec, ctx.signal),
				loadClaudeLocalContextFiles(options.cwd),
			]);
		} catch (error) {
			if (nativeSelection) {
				const message = error instanceof Error ? error.message : String(error);
				managedError = message;
				managedTurnBlocked = true;
				await failManagedGuidance(
					nativeSelection,
					nativeSessionId,
					"rendering",
					"local-context-failed",
					message,
					undefined,
					process.env,
					ctx.signal,
				);
			}
			throw error;
		}
		for (const warning of projectRules.warnings) {
			notify(ctx, `[project-rules] ${warning}`, "warning");
		}

		let systemPrompt: string;
		try {
			let managedGuidance: string | undefined;
			if (nativeSelection) {
				if (!managedBundle)
					throw new Error("native-v1 guidance was not fetched for this lifecycle.");
				managedGuidance = renderManagedGuidance(managedBundle);
			}
			systemPrompt = buildSystemPrompt({
				persona: options.customPrompt?.trim() || DEFAULT_PERSONA,
				managedGuidance,
				millstrandIdentityInstruction:
					nativeIdentityState.status === "bound" ? nativeIdentityState.instruction : undefined,
				cwd: options.cwd,
				currentDate: new Date().toISOString().slice(0, 10),
				selectedTools: options.selectedTools,
				toolSnippets: options.toolSnippets,
				promptGuidelines: options.promptGuidelines,
				toolGuidelines: groupToolGuidelines(
					options.selectedTools,
					options.promptGuidelines,
					toolPromptMetadata,
				),
				contextFiles: [...(options.contextFiles ?? []), ...claudeLocalContextFiles],
				skills: options.skills ?? [],
				appendSystemPrompt: options.appendSystemPrompt,
				dynamicPrompt,
				projectRules: getUnconditionalRules(projectRules.rules),
			});
		} catch (error) {
			if (nativeSelection) {
				const message = error instanceof Error ? error.message : String(error);
				managedError = message;
				managedTurnBlocked = true;
				await failManagedGuidance(
					nativeSelection,
					nativeSessionId,
					"rendering",
					"rendering-failed",
					message,
					undefined,
					process.env,
					ctx.signal,
				);
			}
			throw error;
		}
		if (nativeSelection) {
			try {
				await acknowledgeManagedGuidance(
					nativeSelection,
					nativeSessionId,
					undefined,
					process.env,
					ctx.signal,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				managedError = message;
				managedTurnBlocked = true;
				try {
					await failManagedGuidance(
						nativeSelection,
						nativeSessionId,
						"handoff",
						"acknowledgement-failed",
						message,
						undefined,
						process.env,
						ctx.signal,
					);
				} catch (failureError) {
					const failureMessage =
						failureError instanceof Error ? failureError.message : String(failureError);
					managedError = `${message}; failure receipt was not recorded: ${failureMessage}`;
				}
				throw new Error(managedError);
			}
			if (pi.getFlag(DEBUG_MANAGED_GUIDANCE_FLAG) === true) {
				process.stdout.write(`${formatManagedGuidanceDebug(managedSelection, managedBundle)}\n`);
				process.stdout.write(`${systemPrompt}\n`);
				process.exit(0);
			}
		}
		return { systemPrompt };
	});

	pi.on("agent_start", (_event, ctx) => {
		const prompt = trimOuterEmptyLines(ctx.getSystemPrompt());
		if (prompt) lastMaterializedPrompt = prompt;
		if (!printPromptOnNextTurn) return;
		printPromptOnNextTurn = false;
		process.stdout.write(`${prompt}\n`);
		process.exit(0);
	});
}
