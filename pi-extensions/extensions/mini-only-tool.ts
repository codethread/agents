import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const TOOL_NAME = "mini_model_probe";

type MaybeModel =
	| {
			id: string;
			provider: string;
	  }
	| undefined;

function isMiniModel(model: MaybeModel) {
	return model?.id.toLowerCase().includes("mini") ?? false;
}

export default function (pi: ExtensionAPI) {
	let registered = false;

	function ensureToolRegistered() {
		if (registered) return;

		pi.registerTool({
			name: TOOL_NAME,
			label: "Mini Model Probe",
			description: "Test tool that is only registered when the active model name includes 'mini'",
			promptSnippet: "Inspect the current active model when the model name includes 'mini'",
			promptGuidelines: [
				"Use this tool only when the active model is a mini variant and the user asks about the current model.",
			],
			parameters: Type.Object({
				message: Type.Optional(Type.String({ description: "Optional note to echo back" })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const model = ctx.model;
				const modelName = model ? `${model.provider}/${model.id}` : "no active model";
				const suffix = params.message ? ` | note: ${params.message}` : "";

				return {
					content: [{ type: "text", text: `mini-only tool ran on ${modelName}${suffix}` }],
					details: {
						provider: model?.provider,
						modelId: model?.id,
						message: params.message,
					},
				};
			},
		});

		registered = true;
	}

	function setToolActive(active: boolean) {
		const toolNames = new Set(pi.getActiveTools());
		if (active) toolNames.add(TOOL_NAME);
		else toolNames.delete(TOOL_NAME);
		pi.setActiveTools([...toolNames]);
	}

	function syncToModel(model: MaybeModel, source: string, notify?: (message: string) => void) {
		if (isMiniModel(model)) {
			ensureToolRegistered();
			setToolActive(true);
			notify?.(`Enabled ${TOOL_NAME} for ${model?.provider}/${model?.id} (${source})`);
			return;
		}

		setToolActive(false);
		notify?.(
			model
				? `Disabled ${TOOL_NAME}; active model is ${model.provider}/${model.id} (${source})`
				: `Disabled ${TOOL_NAME}; no active model (${source})`,
		);
	}

	pi.on("session_start", (_event, ctx) => {
		syncToModel(ctx.model, "session_start", (message) => ctx.ui.notify(message, "info"));
	});

	pi.on("model_select", (event, ctx) => {
		syncToModel(event.model, `model_select:${event.source}`, (message) =>
			ctx.ui.notify(message, "info"),
		);
	});
}
