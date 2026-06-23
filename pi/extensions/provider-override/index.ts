import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	getPolicyProvider,
	loadProviderOverrideConfig,
	type ProviderOverrideConfig,
} from "./config.js";

type RegistryModel = Model<Api>;

function formatModel(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

function getProviderModels(ctx: ExtensionContext, provider: string): RegistryModel[] {
	return ctx.modelRegistry.getAll().filter((model) => model.provider === provider);
}

function validateRuntimeConfig(config: ProviderOverrideConfig, ctx: ExtensionContext): void {
	for (const provider of config.providers) {
		const models = getProviderModels(ctx, provider);
		if (models.length === 0) {
			throw new Error(`Provider override config references unknown provider "${provider}"`);
		}
		if (!models.some((model) => ctx.modelRegistry.hasConfiguredAuth(model))) {
			throw new Error(
				`Provider override config provider "${provider}" has no model with configured auth`,
			);
		}
	}
}

function findTargetModel(ctx: ExtensionContext, provider: string, modelId: string): RegistryModel {
	const targetModel = ctx.modelRegistry.find(provider, modelId);
	if (!targetModel) {
		throw new Error(
			`Provider override cannot route ${modelId} to provider "${provider}": equivalent model not found`,
		);
	}
	if (!ctx.modelRegistry.hasConfiguredAuth(targetModel)) {
		throw new Error(
			`Provider override cannot route to ${formatModel(targetModel)}: no configured auth`,
		);
	}
	return targetModel;
}

async function enforceProviderOverride(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: ProviderOverrideConfig,
): Promise<void> {
	const currentModel = ctx.model;
	if (!currentModel) return;
	if (!config.providers.includes(currentModel.provider)) return;
	if (config.ignore.includes(formatModel(currentModel))) return;

	const policyProvider = getPolicyProvider(config, ctx.cwd);
	if (currentModel.provider === policyProvider) return;

	const targetModel = findTargetModel(ctx, policyProvider, currentModel.id);
	const ok = await pi.setModel(targetModel);
	if (!ok) {
		throw new Error(`Provider override failed to select ${formatModel(targetModel)}`);
	}
	ctx.ui.setStatus("provider-override", "(override)");
}

export default function (pi: ExtensionAPI) {
	let config: ProviderOverrideConfig | undefined;

	pi.on("session_start", async (_event, ctx) => {
		config = loadProviderOverrideConfig();
		validateRuntimeConfig(config, ctx);
		await enforceProviderOverride(pi, ctx, config);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (!config) {
			config = loadProviderOverrideConfig();
			validateRuntimeConfig(config, ctx);
		}
		await enforceProviderOverride(pi, ctx, config);
	});
}
