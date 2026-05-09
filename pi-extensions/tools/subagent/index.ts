/**
 * Subagent tool - delegate one task to one specialized agent.
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	discoverAgents,
	findAgentByName,
	formatAgentsForPrompt,
	formatSelectedAgentPrompt,
	getAgentActiveTools,
	getInheritedAgentRuntimeSettings,
	parseAgentFlagCliOverrides,
} from "./agents.js";
import { runSingleAgent } from "./runtime.js";
import {
	formatDebugSection,
	getAvailableAgentsText,
	getParentVisibleResultText,
	isResultError,
	renderSubagentCall,
	renderSubagentResult,
} from "./render.js";
import {
	createDetails,
	createPendingResult,
	type ResolveModelInfo,
	type SingleResult,
	type TaskRequest,
} from "./types.js";

const SubagentParams = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	description: Type.String({
		description:
			"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.String({ description: "Working directory for the agent process" }),
	resume: Type.Optional(
		Type.String({
			pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
			description:
				"Exact UUID from a previous Subagent resume ID line or <subagent-resume-id> tag. Use this to continue that same subagent session for follow-up questions that depend on prior findings.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	let selectedAgentName: string | undefined;
	const lastSessionByAgent = new Map<string, string>();
	let agentFlagCliOverrides = parseAgentFlagCliOverrides(process.argv.slice(2));

	const failAgentSelection = (
		message: string,
		ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
	): never => {
		if (ctx?.hasUI) ctx.ui.notify(message, "error");
		process.stderr.write(`${message}\n`);
		process.exit(1);
	};

	const requireSelectedAgent = (ctx: Pick<ExtensionContext, "cwd" | "hasUI" | "ui">) => {
		if (!selectedAgentName) return undefined;
		const discovery = discoverAgents(ctx.cwd);
		const agent = findAgentByName(discovery.agents, selectedAgentName);
		if (!agent) {
			failAgentSelection(
				`Unknown agent "${selectedAgentName}". Available agents: ${getAvailableAgentsText(discovery.agents)}`,
				ctx,
			);
		}
		return { agent: agent!, discovery };
	};

	const applySelectedAgentSettings = async (ctx: ExtensionContext) => {
		const selected = requireSelectedAgent(ctx);
		if (!selected) return;

		const inherited = getInheritedAgentRuntimeSettings(selected.agent, agentFlagCliOverrides);
		const activeTools = getAgentActiveTools(inherited.tools, pi.getAllTools());
		if (activeTools !== undefined) {
			pi.setActiveTools(activeTools);
		}

		if (inherited.modelRef) {
			const [provider, ...idParts] = inherited.modelRef.split("/");
			const id = idParts.join("/");
			if (!provider || !id) {
				failAgentSelection(
					`Agent "${selected.agent.name}" resolved model "${inherited.modelRef}" is not a fully qualified provider/model identifier. Override with --model or update the agent file.`,
					ctx,
				);
			}

			const model = ctx.modelRegistry.find(provider, id);
			if (!model) {
				failAgentSelection(
					`Agent "${selected.agent.name}" resolved model "${inherited.modelRef}" is not available in this Pi runtime. Override with --model or update the agent file.`,
					ctx,
				);
			}

			const didSetModel = await pi.setModel(model!);
			if (!didSetModel) {
				failAgentSelection(
					`Agent "${selected.agent.name}" requires model "${inherited.modelRef}", but no API key is available. Override with --model or configure credentials.`,
					ctx,
				);
			}
		}

		if (inherited.thinkingLevel) {
			pi.setThinkingLevel(inherited.thinkingLevel);
		}
	};

	pi.registerFlag("agent", {
		description:
			"Inherit a discovered subagent config by name unless overridden by explicit CLI flags",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		agentFlagCliOverrides = parseAgentFlagCliOverrides(process.argv.slice(2));
		const agentFlag = pi.getFlag("agent");
		selectedAgentName = typeof agentFlag === "string" ? agentFlag.trim() : undefined;
		if (!selectedAgentName) {
			selectedAgentName = undefined;
			return;
		}

		requireSelectedAgent(ctx);
		await applySelectedAgentSettings(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		const selected = requireSelectedAgent(ctx);
		const discovery = selected?.discovery ?? discoverAgents(ctx.cwd);
		const promptAddon = formatAgentsForPrompt(discovery.agents);
		const selectedPromptAddon = formatSelectedAgentPrompt(selected?.agent);
		if (!promptAddon && !selectedPromptAddon) return;
		return {
			systemPrompt: `${event.systemPrompt}${promptAddon}${selectedPromptAddon}`,
		};
	});

	pi.registerCommand("debug-agents", {
		description: "Send discovered subagent information into the conversation",
		handler: async (_args, ctx) => {
			const discovery = discoverAgents(ctx.cwd);
			const sections = [
				formatDebugSection("Available agents:", discovery.agents),
				formatDebugSection("User agents:", discovery.userAgents),
				[
					`Project agents dir: ${discovery.projectAgentsDir ?? "(none)"}`,
					formatDebugSection("Project agents:", discovery.projectAgents),
				].join("\n"),
			];

			const content = `Here are the currently discovered subagents:\n\n${sections.join("\n\n")}`;

			if (!ctx.isIdle()) {
				pi.sendUserMessage(content, { deliverAs: "followUp" });
				if (ctx.hasUI) ctx.ui.notify("Queued agent debug info as follow-up", "info");
				return;
			}

			pi.sendUserMessage(content);
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate exactly one task to exactly one specialized subagent.",
			"Pi may run independent subagent tool calls concurrently; do not make a resume-dependent follow-up until the prior result returns its Subagent resume ID.",
			"Provide agent, description, task, and cwd.",
			"When asking a follow-up of the same subagent, first wait for the prior tool result, then pass resume with the exact ID from its <subagent-resume-id> tag; otherwise a fresh isolated session starts.",
			"A terse description field is required for the delegated task.",
			"Bundled, user, and project agents are discovered automatically.",
		].join(" "),
		promptSnippet:
			"Delegate one task to one subagent. Independent subagent calls may run concurrently. For follow-ups, wait for the prior result, then pass resume from its <subagent-resume-id> tag.",
		promptGuidelines: [
			"Use subagent for focused delegation to specialists like scout, review, fixer, or hack.",
			"Each subagent tool call runs one task for one agent. Use multiple independent tool calls when work can run concurrently.",
			"Always provide a terse description (3-8 words) for the delegated task.",
			"If a previous subagent result included <subagent-resume-id> and the next task depends on that same subagent's prior context, set resume to that exact ID.",
			"Never use placeholder or empty resume values. If you do not have the actual ID yet, call the first subagent and wait for its result before making the follow-up call.",
			"Do not dispatch a resume follow-up concurrently with the original call; the ID only exists after the first tool result returns.",
			"Do not omit resume for follow-up questions that ask the same subagent to remember earlier findings.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const discovery = discoverAgents(ctx.cwd);
			const agents = discovery.agents;
			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const parentSessionId = ctx.sessionManager.getSessionId();
			const parentSessionInfo = parentSessionFile
				? { sessionFile: parentSessionFile, sessionId: parentSessionId, cwd: ctx.cwd }
				: undefined;
			const makeDetails = (results: SingleResult[]) =>
				createDetails(discovery.projectAgentsDir, results, parentSessionInfo?.sessionId);
			const resolveModelInfo: ResolveModelInfo = (provider, model) => {
				if (!provider || !model) return undefined;
				const resolved = ctx.modelRegistry.find(provider, model);
				if (!resolved) return undefined;
				return {
					contextWindow: resolved.contextWindow,
					reasoning: resolved.reasoning,
					usingSubscription: ctx.modelRegistry.isUsingOAuth(resolved),
				};
			};

			const followUpText = `${params.description}\n${params.task}`.toLowerCase();
			const looksLikeFollowUp =
				/\b(previous|prior|remember|remembered|context|again|cached|without re-?search|without re-?reading)\b/.test(
					followUpText,
				);
			const request: TaskRequest =
				!params.resume && looksLikeFollowUp && lastSessionByAgent.has(params.agent)
					? { ...params, resume: lastSessionByAgent.get(params.agent) }
					: params;
			let currentResult = createPendingResult(request);
			const emitUpdate = () => {
				if (!onUpdate) return;
				onUpdate({
					content: [{ type: "text", text: `Subagent ${request.agent} running...` }],
					details: makeDetails([currentResult]),
				});
			};

			const result = await runSingleAgent(
				agents,
				request,
				signal,
				(partial) => {
					currentResult = partial;
					emitUpdate();
				},
				resolveModelInfo,
				parentSessionInfo,
			);
			if (result.sessionId) lastSessionByAgent.set(request.agent, result.sessionId);
			const results = [result];

			if (isResultError(result)) {
				return {
					content: [{ type: "text", text: getParentVisibleResultText(result) || "(no output)" }],
					details: makeDetails(results),
					isError: true,
				};
			}
			return {
				content: [{ type: "text", text: getParentVisibleResultText(result) || "(no output)" }],
				details: makeDetails(results),
			};
		},

		renderCall(args, theme, _context) {
			return renderSubagentCall(args, theme);
		},

		renderResult(result, options, theme, _context) {
			return renderSubagentResult(result, options, theme);
		},
	});
}
