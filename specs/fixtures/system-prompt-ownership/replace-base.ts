import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async () => ({
		systemPrompt: "[OWNED-BASE]",
	}));
}
