import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

function getSessionId(ctx: ExtensionContext): string {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!sessionId) throw new Error("Pi did not provide a current session id.");
	return sessionId;
}

function getHarnessMetadata(pi: ExtensionAPI, ctx: ExtensionContext) {
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow;

	return {
		sessionId: getSessionId(ctx),
		sessionName: ctx.sessionManager.getSessionName(),
		sessionFile: ctx.sessionManager.getSessionFile(),
		cwd: ctx.cwd,
		model: ctx.model
			? {
					provider: ctx.model.provider,
					id: ctx.model.id,
					reasoning: ctx.model.reasoning,
					contextWindow: ctx.model.contextWindow,
					usingSubscription: ctx.modelRegistry.isUsingOAuth(ctx.model),
				}
			: null,
		thinking: pi.getThinkingLevel(),
		contextUsage: contextUsage
			? {
					tokens: contextUsage.tokens,
					percent: contextUsage.percent,
					contextWindow,
				}
			: {
					tokens: null,
					percent: null,
					contextWindow: contextWindow ?? null,
				},
	};
}

export default function harnessMetadata(pi: ExtensionAPI) {
	pi.registerTool({
		name: "harness_metadata",
		label: "Harness Metadata",
		description:
			"Return current Pi harness metadata including session id, model, thinking level, and context usage.",
		promptSnippet:
			"Read current harness metadata such as session id, model, thinking level, and context usage.",
		promptGuidelines: [
			"Use harness_metadata when you need the current Pi session id or live harness metadata.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const metadata = getHarnessMetadata(pi, ctx);
			return {
				content: [{ type: "text", text: JSON.stringify(metadata, null, "\t") }],
				details: metadata,
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("harness_metadata")), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as { sessionId?: string; model?: { id?: string } } | undefined;
			const summary = details?.sessionId
				? `session ${details.sessionId}${details.model?.id ? ` • ${details.model.id}` : ""}`
				: "metadata returned";
			return new Text(theme.fg("toolOutput", summary), 0, 0);
		},
	});
}
