import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const EXIT_GRACE_MS = 250;

function isPrintMode(argv = process.argv): boolean {
	return argv.includes("--print") || argv.includes("-p");
}

export default function (pi: ExtensionAPI) {
	if (!isPrintMode()) return;

	pi.on("agent_end", () => {
		setTimeout(() => {
			process.exit(process.exitCode ?? 0);
		}, EXIT_GRACE_MS);
	});
}
