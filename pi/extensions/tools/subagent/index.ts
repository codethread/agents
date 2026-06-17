/**
 * Subagent tool - delegate one task to one specialized agent.
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	discoverAgents,
	findAgentByName,
	findDelegationTarget,
	formatAgentsForPrompt,
	formatSelectedAgentPrompt,
	getAgentActiveTools,
	getInheritedAgentRuntimeSettings,
	parseAgentFlagCliOverrides,
	resolveAgentModelCandidate,
	validateAgentModelPolicies,
	validateAgentModelPolicy,
	type AgentConfig,
	type ModelRegistryLike,
} from "./agents.js";
import {
	findSubagentSessionFileById,
	getLatestSubagentSessionIdForAgent,
	getLatestSwarmResumeIdForTarget,
	getSubagentManifestEntryById,
	getSwarmManifestEntryById,
	getSubagentSessionDirForParent,
	updateSwarmManifest,
} from "./session.js";
import { runSingleAgent } from "./runtime.js";
import { wrapSystemReminder } from "../../shared/xml.js";
import { showDebugMessage } from "../../components/debug-message/index.js";
import { formatMcpSmokeReport, runMcpSmokeTest, type McpConnection } from "./mcp.js";
import { closeMcpConnections, setupAgentMcpServers } from "./mcp-runtime.js";
import {
	formatDebugSection,
	formatDebugSwarmSection,
	getAvailableAgentsText,
	getAvailableSwarmsText,
	getParentVisibleResultText,
	getParentVisibleSwarmResultText,
	isResultError,
	renderSubagentCall,
	renderSubagentResult,
} from "./render.js";
import {
	createDetails,
	createEmptyUsage,
	createPendingResult,
	type ResolveModelInfo,
	type SingleResult,
	type TaskRequest,
} from "./types.js";

const SubagentParams = Type.Object({
	agent: Type.String({ description: "Name of the agent or swarm to invoke" }),
	description: Type.String({
		description:
			"Terse summary of the delegated task (3-8 words), e.g. 'map auth flow in db connector'",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.String({ description: "Working directory for the agent process" }),
	resume: Type.Optional(
		Type.String({
			description:
				"Exact resume ID from a previous Subagent resume ID line or <subagent-resume-id> tag (single-agent UUID or friendly swarm ID). Use this for follow-ups that depend on prior findings.",
		}),
	),
});

export function formatUnknownTargetError(
	requestedTarget: string,
	agents: string,
	swarms: string,
): string {
	const requested = requestedTarget.trim();
	return `Unknown subagent target "${requested}". Available agents: ${agents}. Available swarms: ${swarms}.`;
}

export function isLikelyFollowUpRequest(task: string, description: string): boolean {
	const followUpText = `${description}\n${task}`.toLowerCase();
	return /\b(previous|prior|remember|remembered|context|again|cached|without re-?search|without re-?reading)\b/.test(
		followUpText,
	);
}

const OPERATING_RULES_HEADING = "\n\n## Operating rules\n\n";
const SYSTEM_REMINDER_CLOSE = "\n</system-reminder>";

export function formatMcpStatusPrompt(warnings: string[]): string {
	if (warnings.length === 0) return "";
	const body = [
		"One or more of this agent's configured MCP servers failed to connect, so their tools are unavailable for this run:",
		...warnings.map((warning) => `- ${warning}`),
		"",
		"Do not pretend to have data from those servers. Report the connection error and stop, or proceed only with the tools that are available.",
	].join("\n");
	return `\n\n${wrapSystemReminder("mcp-status", body)}`;
}

export function insertToolingPrompt(systemPrompt: string, promptAddon: string): string {
	if (!promptAddon) return systemPrompt;
	const rulesIndex = systemPrompt.indexOf(OPERATING_RULES_HEADING);
	if (rulesIndex === -1) return `${systemPrompt}\n\n${promptAddon}`;
	const harnessEndIndex = systemPrompt.lastIndexOf(SYSTEM_REMINDER_CLOSE, rulesIndex);
	if (harnessEndIndex === -1)
		return `${systemPrompt.slice(0, rulesIndex)}\n\n${promptAddon}${systemPrompt.slice(rulesIndex)}`;
	return `${systemPrompt.slice(0, harnessEndIndex)}\n\n${promptAddon}${systemPrompt.slice(harnessEndIndex)}`;
}

export function findSwarmMemberResumeState(
	members: readonly { name: string; sessionId?: string; sessionFile?: string }[] | undefined,
	memberName: string,
) {
	return members?.find((member) => member.name === memberName);
}

export function createMissingSwarmMemberResult(
	params: TaskRequest,
	memberName: string,
	resumeId: string,
	existingMember?: { name: string; sessionId?: string; sessionFile?: string },
): SingleResult {
	return {
		agent: memberName,
		agentSource: "unknown",
		task: params.task,
		resumed: true,
		exitCode: 1,
		messages: [],
		stderr: `No session found for swarm member "${memberName}" in resume "${resumeId}".`,
		usage: createEmptyUsage(),
		sessionId: existingMember?.sessionId,
		sessionFile: existingMember?.sessionFile,
	};
}

export function formatRuntimeModelPolicyError(
	agent: AgentConfig,
	modelRegistry: ModelRegistryLike,
): string | undefined {
	const errors = validateAgentModelPolicy(agent, modelRegistry);
	if (errors.length === 0) return undefined;
	return `Subagent ${agent.name} failed: ${errors.join("; ")}`;
}

export function createRuntimeModelPolicyFailureResult(
	params: TaskRequest,
	agent: AgentConfig,
	modelRegistry: ModelRegistryLike,
): SingleResult | undefined {
	const error = formatRuntimeModelPolicyError(agent, modelRegistry);
	if (!error) return undefined;
	return {
		agent: agent.name,
		agentSource: agent.source,
		task: params.task,
		resumed: Boolean(params.resume),
		exitCode: 1,
		messages: [],
		stderr: error,
		usage: createEmptyUsage(),
	};
}

export function getStartupModelPolicyErrors(
	discovery: ReturnType<typeof discoverAgents>,
	modelRegistry: ModelRegistryLike,
	selectedAgentName: string | undefined,
	isSubagentChild: boolean,
): string[] {
	if (isSubagentChild && selectedAgentName) {
		const selectedAgent = findAgentByName(discovery.agents, selectedAgentName);
		return selectedAgent ? validateAgentModelPolicy(selectedAgent, modelRegistry) : [];
	}

	const allDiscoveredAgents = [
		...discovery.agents,
		...discovery.userAgents,
		...discovery.projectAgents,
	];
	return validateAgentModelPolicies(
		Array.from(new Map(allDiscoveredAgents.map((agent) => [agent.filePath, agent])).values()),
		modelRegistry,
	);
}

export function hasAllSwarmMembersFailed(results: SingleResult[]): boolean {
	return results.length > 0 && results.every(isResultError);
}

const DEBUG_MCP_FLAG = "debug-mcp";
export default function (pi: ExtensionAPI) {
	let selectedAgentName: string | undefined;
	let agentFlagCliOverrides = parseAgentFlagCliOverrides(process.argv.slice(2));
	let activeMcpConnections: McpConnection[] = [];
	let mcpSetupWarnings: string[] = [];

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

	const validateStartupModelPolicies = (
		discovery: ReturnType<typeof discoverAgents>,
		ctx: Pick<ExtensionContext, "modelRegistry" | "hasUI" | "ui">,
		selectedName: string | undefined,
		isSubagentChild: boolean,
	) => {
		const errors = getStartupModelPolicyErrors(
			discovery,
			ctx.modelRegistry,
			selectedName,
			isSubagentChild,
		);
		if (errors.length > 0) {
			failAgentSelection(`Invalid subagent model configuration:\n${errors.join("\n")}`, ctx);
		}
	};

	const applySelectedAgentSettings = async (
		ctx: ExtensionContext,
		selected: NonNullable<ReturnType<typeof requireSelectedAgent>>,
	) => {
		if (selected.agent.mcpServersError) {
			failAgentSelection(selected.agent.mcpServersError, ctx);
		}

		const inherited = getInheritedAgentRuntimeSettings(
			selected.agent,
			agentFlagCliOverrides,
			ctx.modelRegistry,
		);

		const mcpSetup = agentFlagCliOverrides.hasToolsOverride
			? { toolNames: [], connections: [], warnings: [] }
			: await setupAgentMcpServers(pi, selected.agent);
		activeMcpConnections = mcpSetup.connections;
		mcpSetupWarnings = mcpSetup.warnings;
		for (const warning of mcpSetup.warnings) {
			if (ctx.hasUI) ctx.ui.notify(warning, "warning");
			process.stderr.write(`${warning}\n`);
		}

		const inheritedActiveTools = getAgentActiveTools(inherited.tools, pi.getAllTools());
		const baseActiveTools = inheritedActiveTools ?? pi.getActiveTools();
		if (inheritedActiveTools !== undefined || mcpSetup.toolNames.length > 0) {
			pi.setActiveTools(Array.from(new Set([...baseActiveTools, ...mcpSetup.toolNames])));
		}

		if (inherited.modelFlagValue) {
			let model: unknown;
			try {
				model = resolveAgentModelCandidate(inherited.modelFlagValue, ctx.modelRegistry).model;
			} catch {
				failAgentSelection(
					`Agent "${selected.agent.name}" resolved model "${inherited.modelFlagValue}" is not available in this Pi runtime. Override with --model or update the agent file.`,
					ctx,
				);
			}

			const didSetModel = await pi.setModel(model! as Parameters<typeof pi.setModel>[0]);
			if (!didSetModel) {
				failAgentSelection(
					`Agent "${selected.agent.name}" requires model "${inherited.modelFlagValue}", but no API key is available. Override with --model or configure credentials.`,
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

	pi.registerFlag(DEBUG_MCP_FLAG, {
		description:
			"Connect a discovered agent's MCP servers headlessly, print the tool/connection report, and exit",
		type: "string",
	});

	const runMcpSmokeReport = async (agentName: string, cwd: string): Promise<string> => {
		const discovery = discoverAgents(cwd);
		const agent = findAgentByName(discovery.agents, agentName);
		if (!agent) {
			return `Unknown agent "${agentName}". Available agents: ${getAvailableAgentsText(discovery.agents)}`;
		}
		if (agent.mcpServersError) return agent.mcpServersError;
		const results = await runMcpSmokeTest(agent.mcpServers ?? []);
		return formatMcpSmokeReport(agent.name, results);
	};

	pi.on("session_shutdown", async () => {
		const connections = activeMcpConnections;
		activeMcpConnections = [];
		await closeMcpConnections(connections);
	});

	pi.on("session_start", async (_event, ctx) => {
		agentFlagCliOverrides = parseAgentFlagCliOverrides(process.argv.slice(2));
		mcpSetupWarnings = [];
		const debugMcpFlag = pi.getFlag(DEBUG_MCP_FLAG);
		const debugMcpAgent = typeof debugMcpFlag === "string" ? debugMcpFlag.trim() : undefined;
		if (debugMcpAgent) {
			const report = await runMcpSmokeReport(debugMcpAgent, ctx.cwd);
			process.stdout.write(`${report}\n`);
			process.exit(0);
		}
		const agentFlag = pi.getFlag("agent");
		selectedAgentName = typeof agentFlag === "string" ? agentFlag.trim() : undefined;
		const discovery = discoverAgents(ctx.cwd);
		const isSubagentChild = process.env.PI_SUBAGENT === "1";
		if (!selectedAgentName) {
			validateStartupModelPolicies(discovery, ctx, selectedAgentName, isSubagentChild);
			selectedAgentName = undefined;
			return;
		}

		const agent = findAgentByName(discovery.agents, selectedAgentName);
		if (!agent) {
			failAgentSelection(
				`Unknown agent "${selectedAgentName}". Available agents: ${getAvailableAgentsText(discovery.agents)}`,
				ctx,
			);
		}
		validateStartupModelPolicies(discovery, ctx, selectedAgentName, isSubagentChild);
		await applySelectedAgentSettings(ctx, { agent: agent!, discovery });
	});

	pi.on("before_agent_start", (event, ctx) => {
		const selected = requireSelectedAgent(ctx);
		const discovery = selected?.discovery ?? discoverAgents(ctx.cwd);
		const promptAddon = formatAgentsForPrompt(discovery.agents, discovery.swarms);
		const selectedPromptAddon = formatSelectedAgentPrompt(selected?.agent);
		const mcpStatusAddon = formatMcpStatusPrompt(mcpSetupWarnings);
		if (!promptAddon && !selectedPromptAddon && !mcpStatusAddon) return;
		return {
			systemPrompt: `${insertToolingPrompt(event.systemPrompt, promptAddon)}${selectedPromptAddon}${mcpStatusAddon}`,
		};
	});

	pi.registerCommand("debug-agents", {
		description: "Show discovered subagent information",
		handler: async (_args, ctx) => {
			const discovery = discoverAgents(ctx.cwd);
			const sections = [
				formatDebugSection("Available agents:", discovery.agents),
				formatDebugSwarmSection("Available swarms:", discovery.swarms),
				[
					`Extension agent roots: ${discovery.extensionAgentRoots.length > 0 ? discovery.extensionAgentRoots.join(", ") : "(none)"}`,
					formatDebugSection("Extension agents:", discovery.extensionAgents),
					formatDebugSwarmSection("Extension swarms:", discovery.extensionSwarms),
				].join("\n"),
				formatDebugSection("User agents:", discovery.userAgents),
				formatDebugSwarmSection("User swarms:", discovery.userSwarms),
				[
					`Project agents dir: ${discovery.projectAgentsDir ?? "(none)"}`,
					formatDebugSection("Project agents:", discovery.projectAgents),
				].join("\n"),
				[
					`Project swarms dir: ${discovery.projectSwarmsDir ?? "(none)"}`,
					formatDebugSwarmSection("Project swarms:", discovery.projectSwarms),
				].join("\n"),
			];

			const content = `Here are the currently discovered subagents:\n\n${sections.join("\n\n")}`;

			if (!ctx.hasUI) {
				process.stdout.write(`${content}\n`);
				return;
			}

			await showDebugMessage(ctx, {
				headingText: "Debug Agents",
				subheadingText: "discovered subagents and swarms",
				markdownBody: content,
				sendMarkdownToAgent: async () => {
					if (!ctx.isIdle()) {
						pi.sendUserMessage(content, { deliverAs: "followUp" });
						return;
					}
					pi.sendUserMessage(content);
				},
			});
		},
	});

	pi.registerCommand("debug-mcp", {
		description:
			"Connect a discovered agent's MCP servers and report tools or connection errors (usage: /debug-mcp <agent>)",
		handler: async (args, ctx) => {
			const agentName = args.trim();
			if (!agentName) {
				const discovery = discoverAgents(ctx.cwd);
				const withMcp = discovery.agents.filter(
					(agent) => (agent.mcpServers?.length ?? 0) > 0 || Boolean(agent.mcpServersError),
				);
				const message =
					withMcp.length > 0
						? `Usage: /debug-mcp <agent>. Agents with MCP servers: ${withMcp.map((agent) => agent.name).join(", ")}.`
						: "No discovered agents declare mcpServers. Usage: /debug-mcp <agent>.";
				if (!ctx.hasUI) process.stdout.write(`${message}\n`);
				else ctx.ui.notify(message, "info");
				return;
			}

			if (ctx.hasUI) ctx.ui.notify(`Connecting MCP servers for "${agentName}"...`, "info");
			const report = await runMcpSmokeReport(agentName, ctx.cwd);

			if (!ctx.hasUI) {
				process.stdout.write(`${report}\n`);
				return;
			}

			await showDebugMessage(ctx, {
				headingText: "Debug MCP",
				subheadingText: `agent ${agentName}`,
				markdownBody: report,
				sendMarkdownToAgent: async () => {
					await pi.sendUserMessage(report);
				},
			});
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate one task to one discovered subagent, or one discovered swarm.",
			"Pi may run independent subagent tool calls concurrently; do not make a resume-dependent follow-up until the prior result returns its Subagent resume ID.",
			"Provide agent, description, task, and cwd.",
			"When asking a follow-up of the same delegated target, first wait for the prior tool result, then pass resume with the exact ID from its <subagent-resume-id> tag; otherwise a fresh isolated session starts.",
			"A terse description field is required for the delegated task.",
			"Extension, user, and project agents are discovered automatically.",
		].join(" "),
		promptSnippet:
			"Delegate one task to one subagent or swarm. Independent subagent calls may run concurrently. For follow-ups, wait for the prior result, then pass resume from its <subagent-resume-id> tag.",
		promptGuidelines: [
			"Use subagent for focused delegation to specialists like scout, review, fixer, or hack.",
			"Each subagent tool call runs one task for one agent. Use multiple independent tool calls when work can run concurrently.",
			"Swarm calls dispatch all swarm members concurrently in one tool call, each with its own isolated execution.",
			"Always provide a terse description (3-8 words) for the delegated task.",
			"If a previous subagent result included <subagent-resume-id> and the next task depends on that same context, set resume to that exact ID.",
			"Never use placeholder or empty resume values. If you do not have the actual ID yet, call the first subagent and wait for its result before making the follow-up call.",
			"Do not dispatch a resume follow-up concurrently with the original call; the ID only exists after the first tool result returns.",
			"Do not omit resume for follow-up questions that ask the same subagent to remember earlier findings.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const discovery = discoverAgents(params.cwd);
			const agents = discovery.agents;
			const parentSessionFile = ctx.sessionManager.getSessionFile();
			const parentSessionId = ctx.sessionManager.getSessionId();
			const parentSessionInfo = parentSessionFile
				? { sessionFile: parentSessionFile, sessionId: parentSessionId, cwd: ctx.cwd }
				: undefined;
			const subagentSessionDir = parentSessionInfo
				? getSubagentSessionDirForParent(parentSessionInfo.sessionId, params.cwd)
				: undefined;
			const toolStartedAt = Date.now();
			let toolCompletedAt: number | undefined;
			const makeDetails = (results: SingleResult[], targetName = params.agent) =>
				createDetails(discovery.projectAgentsDir, results, parentSessionInfo?.sessionId, {
					targetName,
					startedAt: toolStartedAt,
					completedAt: toolCompletedAt,
				});
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

			const target = findDelegationTarget(discovery, params.agent);
			if (!target) {
				return {
					content: [
						{
							type: "text",
							text: formatUnknownTargetError(
								params.agent,
								getAvailableAgentsText(discovery.agents),
								getAvailableSwarmsText(discovery.swarms),
							),
						},
					],
					details: makeDetails([]),
					isError: true,
				};
			}

			if (target.kind === "swarm") {
				const followsUp = isLikelyFollowUpRequest(params.task, params.description);
				const explicitResumeId = params.resume?.trim();

				const explicitSwarmManifestEntry = explicitResumeId
					? parentSessionInfo && subagentSessionDir
						? await getSwarmManifestEntryById(subagentSessionDir, explicitResumeId)
						: undefined
					: undefined;
				if (explicitResumeId && !parentSessionInfo) {
					return {
						content: [
							{
								type: "text",
								text: "Cannot resume a swarm when the parent session is not persisted.",
							},
						],
						details: makeDetails([]),
						isError: true,
					};
				}

				if (explicitResumeId && !explicitSwarmManifestEntry) {
					return {
						content: [
							{
								type: "text",
								text: `Unknown swarm resume ID "${explicitResumeId}" for target "${target.swarm.name}".`,
							},
						],
						details: makeDetails([]),
						isError: true,
					};
				}

				if (
					explicitResumeId &&
					explicitSwarmManifestEntry &&
					explicitSwarmManifestEntry.target !== target.swarm.name
				) {
					return {
						content: [
							{
								type: "text",
								text: `Swarm resume ID "${explicitResumeId}" is for target "${explicitSwarmManifestEntry.target}", not "${target.swarm.name}".`,
							},
						],
						details: makeDetails([]),
						isError: true,
					};
				}

				const latestSwarmResumeId =
					!explicitResumeId && followsUp && parentSessionInfo
						? await getLatestSwarmResumeIdForTarget(subagentSessionDir!, target.swarm.name)
						: undefined;
				const latestSwarmManifestEntry = latestSwarmResumeId
					? await getSwarmManifestEntryById(subagentSessionDir!, latestSwarmResumeId)
					: undefined;
				const latestResumeTargetFound = Boolean(latestSwarmManifestEntry);
				const freshSwarmResumeId =
					!explicitResumeId && !latestSwarmResumeId && parentSessionInfo
						? `swarm-${target.swarm.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "swarm"}-${randomUUID()}`
						: undefined;
				const swarmResumeId =
					explicitResumeId ||
					(latestResumeTargetFound && latestSwarmResumeId) ||
					freshSwarmResumeId;
				const swarmManifestEntry = explicitSwarmManifestEntry || latestSwarmManifestEntry;
				const resumeManifestEntry = swarmResumeId ? swarmManifestEntry : undefined;

				type SwarmMemberRequestPlan =
					| { kind: "fresh"; request: TaskRequest }
					| { kind: "resume"; request: TaskRequest }
					| { kind: "missing"; result: SingleResult };
				const memberRequests: SwarmMemberRequestPlan[] = target.swarm.members.map((memberName) => {
					const memberAgent = agents.find((agent) => agent.name === memberName);
					if (memberAgent) {
						const invalidMemberResult = createRuntimeModelPolicyFailureResult(
							{ ...params, agent: memberName },
							memberAgent,
							ctx.modelRegistry,
						);
						if (invalidMemberResult) return { kind: "missing", result: invalidMemberResult };
					}

					if (!resumeManifestEntry) {
						return {
							kind: "fresh",
							request: {
								...params,
								agent: memberName,
								resume: undefined,
							},
						};
					}

					const matchingMemberState = findSwarmMemberResumeState(
						resumeManifestEntry.members,
						memberName,
					);
					if (!matchingMemberState?.sessionId) {
						return {
							kind: "missing",
							result: createMissingSwarmMemberResult(
								params,
								memberName,
								swarmResumeId!,
								matchingMemberState,
							),
						};
					}

					return {
						kind: "resume",
						request: {
							...params,
							agent: memberName,
							resume: matchingMemberState.sessionId,
						},
					};
				});
				const results: SingleResult[] = memberRequests.map((memberRequest) =>
					memberRequest.kind === "missing"
						? memberRequest.result
						: createPendingResult(memberRequest.request),
				);
				const emitUpdate = () => {
					if (!onUpdate) return;
					onUpdate({
						content: [{ type: "text", text: `Subagent ${params.agent} running...` }],
						details: makeDetails(results),
					});
				};
				emitUpdate();

				const finalResults = await Promise.all(
					memberRequests.map((memberRequest, index) =>
						memberRequest.kind === "missing"
							? Promise.resolve(results[index])
							: runSingleAgent(
									agents,
									memberRequest.request,
									signal,
									(partial) => {
										results[index] = partial;
										emitUpdate();
									},
									resolveModelInfo,
									parentSessionInfo,
									ctx.modelRegistry,
								),
					),
				);

				if (parentSessionInfo && subagentSessionDir && swarmResumeId) {
					await updateSwarmManifest(
						subagentSessionDir,
						{
							sessionFile: parentSessionInfo.sessionFile,
							sessionId: parentSessionInfo.sessionId,
						},
						params.cwd,
						{
							id: swarmResumeId,
							target: target.swarm.name,
							description: params.description,
							prompt: params.task,
							timestamp: new Date().toISOString(),
							members: finalResults.map((result, index) => {
								const previousState = findSwarmMemberResumeState(
									swarmManifestEntry?.members,
									target.swarm.members[index],
								);
								return {
									name: result.agent,
									sessionId: result.sessionId ?? previousState?.sessionId,
									sessionFile: result.sessionFile ?? (previousState?.sessionFile || undefined),
									lastExitCode: result.exitCode,
								};
							}),
						},
					);
				}

				const swarmText =
					getParentVisibleSwarmResultText(finalResults, swarmResumeId) || "(no output)";
				const allFailed = hasAllSwarmMembersFailed(finalResults);
				toolCompletedAt = Date.now();
				return {
					content: [{ type: "text", text: swarmText }],
					details: makeDetails(finalResults, target.swarm.name),
					isError: allFailed,
				};
			}

			const invalidSingleResult = createRuntimeModelPolicyFailureResult(
				{ ...params, agent: target.agent.name },
				target.agent,
				ctx.modelRegistry,
			);
			if (invalidSingleResult) {
				return {
					content: [{ type: "text", text: getParentVisibleResultText(invalidSingleResult) }],
					details: makeDetails([invalidSingleResult]),
					isError: true,
				};
			}

			const hasExplicitResume = params.resume !== undefined;
			const explicitResumeId = params.resume?.trim();

			if (hasExplicitResume && explicitResumeId && parentSessionInfo && subagentSessionDir) {
				const explicitResumeManifest = await getSubagentManifestEntryById(
					subagentSessionDir,
					explicitResumeId,
				);
				if (!explicitResumeManifest) {
					return {
						content: [
							{
								type: "text",
								text: `Unknown subagent resume ID "${explicitResumeId}" for target "${target.agent.name}".`,
							},
						],
						details: makeDetails([]),
						isError: true,
					};
				}
				if (explicitResumeManifest.agent !== target.agent.name) {
					return {
						content: [
							{
								type: "text",
								text: `Subagent resume ID "${explicitResumeId}" is for agent "${explicitResumeManifest.agent}", not "${target.agent.name}".`,
							},
						],
						details: makeDetails([]),
						isError: true,
					};
				}
			}

			const followUpResumeIdFromManifest =
				!hasExplicitResume &&
				isLikelyFollowUpRequest(params.task, params.description) &&
				parentSessionInfo &&
				subagentSessionDir
					? await getLatestSubagentSessionIdForAgent(subagentSessionDir, target.agent.name)
					: undefined;
			const lastSessionIdFromManifest = followUpResumeIdFromManifest
				? (await findSubagentSessionFileById(subagentSessionDir!, followUpResumeIdFromManifest))
					? followUpResumeIdFromManifest
					: undefined
				: undefined;

			const request: TaskRequest =
				hasExplicitResume && explicitResumeId
					? {
							...params,
							agent: target.agent.name,
							resume: explicitResumeId,
						}
					: lastSessionIdFromManifest
						? {
								...params,
								agent: target.agent.name,
								resume: lastSessionIdFromManifest,
							}
						: { ...params, agent: target.agent.name };

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
				ctx.modelRegistry,
			);
			const results = [result];
			toolCompletedAt = Date.now();

			if (isResultError(result)) {
				return {
					content: [{ type: "text", text: getParentVisibleResultText(result) || "(no output)" }],
					details: makeDetails(results, target.agent.name),
					isError: true,
				};
			}
			return {
				content: [{ type: "text", text: getParentVisibleResultText(result) || "(no output)" }],
				details: makeDetails(results, target.agent.name),
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
