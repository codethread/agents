/**
 * Subagent tool - delegate tasks to specialized agents.
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { discoverAgents, formatAgentsForPrompt } from "./agents.js";
import { mapWithConcurrencyLimit, runSingleAgent } from "./runtime.js";
import {
	formatDebugSection,
	getAvailableAgentsText,
	getFinalOutput,
	getResultErrorText,
	isResultError,
	renderSubagentCall,
	renderSubagentResult,
} from "./render.js";
import {
	createDetails,
	createPendingResult,
	MAX_CONCURRENCY,
	MAX_PARALLEL_TASKS,
	RUNNING_EXIT_CODE,
	type ResolveModelInfo,
	type SingleResult,
} from "./types.js";

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	description: Type.String({
		description:
			"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.String({ description: "Working directory for the agent process" }),
});

const SubagentParams = Type.Object({
	tasks: Type.Array(TaskItem, {
		description: "Array of {agent, description, task, cwd} to execute",
	}),
});

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const discovery = discoverAgents(ctx.cwd);
		const promptAddon = formatAgentsForPrompt(discovery.agents);
		if (!promptAddon) return;
		return {
			systemPrompt: `${event.systemPrompt}${promptAddon}`,
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
			"Delegate tasks to specialized subagents with isolated context.",
			"Provide a tasks array where each item includes agent, description, task, and cwd.",
			"A terse description field is required for delegated tasks.",
			"Bundled, user, and project agents are discovered automatically.",
		].join(" "),
		promptSnippet: "Delegate tasks to specialized subagents",
		promptGuidelines: [
			"Always provide a terse description (3-8 words) for each delegated task.",
			"Use a single-item tasks array for focused work; use multiple items for independent parallel tasks.",
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

			if (params.tasks.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide at least one task. Available agents: ${getAvailableAgentsText(agents)}`,
						},
					],
					details: makeDetails([]),
				};
			}

			if (params.tasks.length > MAX_PARALLEL_TASKS) {
				return {
					content: [
						{
							type: "text",
							text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
						},
					],
					details: makeDetails([]),
				};
			}

			const allResults = params.tasks.map(createPendingResult);
			const emitParallelUpdate = () => {
				if (!onUpdate) return;
				const running = allResults.filter((result) => result.exitCode === RUNNING_EXIT_CODE).length;
				const done = allResults.length - running;
				onUpdate({
					content: [
						{
							type: "text",
							text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
						},
					],
					details: makeDetails([...allResults]),
				});
			};

			const results = await mapWithConcurrencyLimit(
				params.tasks,
				MAX_CONCURRENCY,
				async (task, index) => {
					const result = await runSingleAgent(
						agents,
						task,
						signal,
						(partial) => {
							allResults[index] = partial;
							emitParallelUpdate();
						},
						resolveModelInfo,
						parentSessionInfo,
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				},
			);

			if (results.length === 1) {
				const result = results[0];
				if (isResultError(result)) {
					return {
						content: [{ type: "text", text: getResultErrorText(result) || "(no output)" }],
						details: makeDetails(results),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails(results),
				};
			}

			const successCount = results.filter((result) => !isResultError(result)).length;
			const summaries = results.map((result) => {
				if (isResultError(result)) {
					const errorText = getResultErrorText(result);
					const preview = errorText.slice(0, 100) + (errorText.length > 100 ? "..." : "");
					return `[${result.agent}] failed: ${preview || "(no output)"}`;
				}
				const output = getFinalOutput(result.messages);
				const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
				return `[${result.agent}] completed: ${preview || "(no output)"}`;
			});
			return {
				content: [
					{
						type: "text",
						text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
					},
				],
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
