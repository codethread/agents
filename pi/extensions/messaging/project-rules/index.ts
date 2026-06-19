import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	discoverProjectRules,
	getUnconditionalRules,
	matchesRule,
	matchingRules,
	normalizeProjectPath,
	renderProjectRulesReminder,
	ruleSignature,
	type ProjectRule,
} from "../../shared/project-rules.js";

export const PROJECT_RULES_MESSAGE_TYPE = "project-rules";

type RuleMessageDetails = {
	rulePaths: string[];
	triggeredBy: string[];
};

type BeforeAgentStartEvent = { prompt: string };
type ToolResultEvent = {
	toolName: string;
	input: Record<string, unknown>;
	isError: boolean;
};

export function renderProjectRulesMessage(
	message: { details?: RuleMessageDetails },
	_options: unknown,
	theme: Theme,
) {
	const count = message.details?.rulePaths.length ?? 0;
	const suffix = count > 0 ? ` (${count})` : "";
	return new Text(theme.fg("dim", `Project rules sent to agent${suffix}`), 1, 0);
}

function notifyWarnings(ctx: Pick<ExtensionContext, "hasUI" | "ui">, warnings: string[]) {
	if (!ctx.hasUI) return;
	for (const warning of warnings) ctx.ui.notify(`[project-rules] ${warning}`, "warning");
}

function extractPromptPaths(prompt: string): string[] {
	const paths = new Set<string>();
	for (const match of prompt.matchAll(/<file\s+name=["']([^"']+)["']/g)) {
		paths.add(match[1]);
	}
	for (const match of prompt.matchAll(/(?:^|\s)@([^\s`'"<>]+(?:\.[A-Za-z0-9]+)?)/g)) {
		const candidate = match[1].replace(/[),.;:!?]+$/, "");
		if (candidate.includes("/") || candidate.includes(".")) paths.add(candidate);
	}
	return [...paths];
}

function sendKey(rule: ProjectRule, trigger: string): string {
	return `${ruleSignature(rule)}:${trigger}`;
}

function changedUnconditionalKey(rule: ProjectRule): string {
	return ruleSignature(rule);
}

export default function projectRulesMessagingExtension(pi: ExtensionAPI) {
	const sentScoped = new Set<string>();
	let baselineUnconditional = new Map<string, string>();
	let baselineInitialized = false;
	let lastWarned = new Set<string>();

	pi.registerMessageRenderer(PROJECT_RULES_MESSAGE_TYPE, renderProjectRulesMessage);

	pi.on("session_start", () => {
		sentScoped.clear();
		baselineUnconditional = new Map();
		baselineInitialized = false;
		lastWarned = new Set();
	});

	async function discover(ctx: ExtensionContext) {
		const discovery = await discoverProjectRules(ctx.cwd, pi.exec, ctx.signal);
		const newWarnings = discovery.warnings.filter((warning) => !lastWarned.has(warning));
		for (const warning of newWarnings) lastWarned.add(warning);
		notifyWarnings(ctx, newWarnings);
		return discovery;
	}

	function buildMessage(rules: ProjectRule[], triggeredBy: string[]) {
		const content = renderProjectRulesReminder(rules, { triggeredBy });
		if (!content) return undefined;
		return {
			customType: PROJECT_RULES_MESSAGE_TYPE,
			content,
			display: true,
			details: {
				rulePaths: rules.map((rule) => rule.path),
				triggeredBy,
			} satisfies RuleMessageDetails,
		};
	}

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx) => {
		const discovery = await discover(ctx);
		const messages: Array<ReturnType<typeof buildMessage>> = [];

		const unconditional = getUnconditionalRules(discovery.rules);
		const changedUnconditional = unconditional.filter((rule) => {
			const current = changedUnconditionalKey(rule);
			const previous = baselineUnconditional.get(rule.path);
			baselineUnconditional.set(rule.path, current);
			return baselineInitialized && previous !== current;
		});
		for (const stalePath of [...baselineUnconditional.keys()]) {
			if (!unconditional.some((rule) => rule.path === stalePath))
				baselineUnconditional.delete(stalePath);
		}
		baselineInitialized = true;
		messages.push(buildMessage(changedUnconditional, []));

		const promptPaths = extractPromptPaths(event.prompt)
			.map((filePath) => normalizeProjectPath(filePath, ctx.cwd, discovery.projectRoot))
			.filter((filePath): filePath is string => Boolean(filePath));
		const scopedRules = matchingRules(discovery.rules, promptPaths).filter((rule) => {
			const triggers = promptPaths.filter((filePath) =>
				matchingRules([rule], [filePath]).some((match) => match.path === rule.path),
			);
			return triggers.some((trigger) => !sentScoped.has(sendKey(rule, trigger)));
		});
		for (const rule of scopedRules) {
			for (const trigger of promptPaths) {
				if (matchesRule(rule, trigger)) sentScoped.add(sendKey(rule, trigger));
			}
		}
		messages.push(buildMessage(scopedRules, promptPaths));

		const built = messages.filter((message): message is NonNullable<typeof message> =>
			Boolean(message),
		);
		if (built.length === 0) return;
		return built.length === 1
			? { message: built[0] }
			: {
					message: {
						customType: PROJECT_RULES_MESSAGE_TYPE,
						content: built.map((message) => message.content).join("\n\n"),
						display: true,
						details: {
							rulePaths: built.flatMap((message) => message.details.rulePaths),
							triggeredBy: [...new Set(built.flatMap((message) => message.details.triggeredBy))],
						} satisfies RuleMessageDetails,
					},
				};
	});

	pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
		if (event.toolName !== "read" || event.isError) return;
		const rawPath = event.input.path;
		if (typeof rawPath !== "string") return;
		const discovery = await discover(ctx);
		const projectPath = normalizeProjectPath(rawPath, ctx.cwd, discovery.projectRoot);
		if (!projectPath) return;
		const rules = matchingRules(discovery.rules, [projectPath]).filter((rule) => {
			const key = sendKey(rule, projectPath);
			if (sentScoped.has(key)) return false;
			sentScoped.add(key);
			return true;
		});
		const message = buildMessage(rules, [projectPath]);
		if (!message) return;
		pi.sendMessage(message, { deliverAs: "steer" });
	});
}
