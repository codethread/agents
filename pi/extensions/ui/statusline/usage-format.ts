import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {}

export interface ModelDisplayOptions {
	provider?: string;
	providerMarker?: string;
	model?: string;
	thinkingLevel?: string;
	reasoning?: boolean;
	includeProvider?: boolean;
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCost(cost: number): string {
	return `$${cost.toFixed(3)}`;
}

export function formatModelDisplay(options: ModelDisplayOptions): string {
	const modelName = options.model || "no-model";
	let result = modelName;

	if (options.reasoning) {
		const thinkingLevel = options.thinkingLevel || "off";
		result =
			thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}

	if (options.includeProvider && options.provider) {
		const marker = options.providerMarker ? ` ${options.providerMarker}` : "";
		const provider = `(${options.provider}${marker})`;
		result = `${result} ${provider}`;
	}

	return result;
}
