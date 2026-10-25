import { createReadTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import { estimateTokens, formatTokenCount, getTokenUsageColor } from "./token-usage.js";

/**
 * Compact read renderer.
 * Keeps built-in read execution, but shows only file path and estimated tokens.
 */
function mapReadError(message: string): string {
	if (message.includes("ENOENT")) return "No such path";
	return message;
}

export default function (pi: ExtensionAPI) {
	const builtinRead = createReadTool(process.cwd());

	pi.registerTool({
		...builtinRead,
		name: "read",

		renderCall(args, theme) {
			const path = (args.path as string | undefined) ?? "(unknown)";
			return new Text(theme.fg("toolTitle", theme.bold("read ")) + theme.fg("muted", path), 0, 0);
		},

		renderResult(result, { isPartial }, theme, context) {
			if (isPartial) return new Container();

			if (!context.isError) {
				const output = result.content
					.filter((item) => item.type === "text")
					.map((item) => item.text)
					.join("\n");
				const tokens = estimateTokens(output);
				return new Text(
					theme.fg("dim", "[") +
						theme.fg(getTokenUsageColor(tokens), `${formatTokenCount(tokens)} tokens`) +
						theme.fg("dim", "]"),
					0,
					0,
				);
			}

			const first = result.content?.[0];
			const rawMessage = first?.type === "text" ? first.text : "read failed";
			const message = mapReadError(rawMessage);
			return new Text(theme.fg("error", message), 0, 0);
		},
	});
}
