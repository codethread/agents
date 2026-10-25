export function estimateTokens(text: string) {
	// Four characters per token is a rough estimate, not a model-specific count.
	return Math.ceil(text.length / 4);
}

export function formatTokenCount(tokens: number) {
	return tokens > 1000 ? `${Math.round(tokens / 1000)}K` : `${tokens}`;
}

export function getTokenUsageColor(tokens: number): "success" | "warning" | "error" {
	if (tokens < 500) return "success";
	if (tokens < 1000) return "warning";
	return "error";
}
