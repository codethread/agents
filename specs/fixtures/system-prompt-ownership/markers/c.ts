import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const marker = path.basename(import.meta.url, path.extname(import.meta.url)).toUpperCase();

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n[MARKER:${marker}]`,
	}));
}
