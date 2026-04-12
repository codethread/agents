/**
 * Subagent tool - delegate tasks to specialized agents.
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports two modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { discoverAgents, formatAgentsForPrompt } from "./agents.js";
import type { AgentConfig } from "./agents.js";
import { mapWithConcurrencyLimit, runSingleAgent } from "./runtime.js";
import {
	formatDebugSection,
	getAvailableAgentsText,
	getFinalOutput,
	getRequestedAgentNames,
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
	type SubagentMode,
} from "./types.js";

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	description: Type.String({
		description:
			"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({ description: "Name of the agent to invoke (for single mode)" }),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
		}),
	),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, description, task} for parallel execution",
		}),
	),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description: "Prompt before running project-local agents. Default: true.",
			default: true,
		}),
	),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process (single mode)" }),
	),
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
			"Modes: single (agent + description + task), parallel (tasks array; each task includes description + task).",
			"A terse description field is required for delegated tasks.",
			"Bundled, user, and project agents are discovered automatically.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const discovery = discoverAgents(ctx.cwd);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task && params.description);
			const singleFieldsPresent = Boolean(params.agent || params.task || params.description);
			const modeCount = Number(hasTasks) + Number(hasSingle);
			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const parentSessionId = ctx.sessionManager.getSessionId();
			const parentSessionInfo = parentSessionFile
				? { sessionFile: parentSessionFile, sessionId: parentSessionId, cwd: ctx.cwd }
				: undefined;
			const makeDetails = (mode: SubagentMode, results: SingleResult[]) =>
				createDetails(mode, discovery.projectAgentsDir, results, parentSessionInfo?.sessionId);
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

			if (modeCount !== 1) {
				const missingDescription = singleFieldsPresent && !hasSingle && !hasTasks;
				const guidance = missingDescription
					? "Single mode requires agent, description, and task."
					: "Provide exactly one mode.";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. ${guidance}\nAvailable agents: ${getAvailableAgentsText(agents)}`,
						},
					],
					details: makeDetails("single", []),
				};
			}

			if (confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = getRequestedAgentNames({
					agent: params.agent,
					tasks: params.tasks,
				});
				const projectAgentsRequested = requestedAgentNames
					.map((name) => agents.find((agent) => agent.name === name))
					.filter((agent): agent is AgentConfig => agent?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((agent) => agent.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok) {
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasTasks ? "parallel" : "single", []),
						};
					}
				}
			}

			if (params.tasks?.length) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel", []),
					};
				}

				const allResults = params.tasks.map(createPendingResult);
				const emitParallelUpdate = () => {
					if (!onUpdate) return;
					const running = allResults.filter(
						(result) => result.exitCode === RUNNING_EXIT_CODE,
					).length;
					const done = allResults.length - running;
					onUpdate({
						content: [
							{
								type: "text",
								text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
							},
						],
						details: makeDetails("parallel", [...allResults]),
					});
				};

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					MAX_CONCURRENCY,
					async (task, index) => {
						const result = await runSingleAgent(
							ctx.cwd,
							agents,
							task,
							task.description,
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

				const successCount = results.filter((result) => result.exitCode === 0).length;
				const summaries = results.map((result) => {
					const output = getFinalOutput(result.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${result.agent}] ${result.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel", results),
				};
			}

			if (params.agent && params.task && params.description) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					{ agent: params.agent, task: params.task, cwd: params.cwd },
					params.description,
					signal,
					(partial) => {
						if (!onUpdate) return;
						onUpdate({
							content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
							details: makeDetails("single", [partial]),
						});
					},
					resolveModelInfo,
					parentSessionInfo,
				);

				if (isResultError(result)) {
					return {
						content: [
							{
								type: "text",
								text: `Agent ${result.stopReason || "failed"}: ${getResultErrorText(result)}`,
							},
						],
						details: makeDetails("single", [result]),
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single", [result]),
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available agents: ${getAvailableAgentsText(agents)}`,
					},
				],
				details: makeDetails("single", []),
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
