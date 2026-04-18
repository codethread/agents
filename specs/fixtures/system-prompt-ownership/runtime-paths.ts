import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerFlag("debug-runtime-paths", {
		description: "Print runtime/package path probes and exit",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (!pi.getFlag("debug-runtime-paths")) return;

		const packageEntryUrl = import.meta.resolve("@mariozechner/pi-coding-agent");
		const packageEntry = packageEntryUrl.startsWith("file://")
			? new URL(packageEntryUrl).pathname
			: packageEntryUrl;
		const report = {
			cwd: ctx.cwd,
			processArgv: process.argv,
			execPath: process.execPath,
			packageEntry,
			packageRootGuess: path.resolve(path.dirname(packageEntry), ".."),
			packageJsonPathGuess: path.resolve(path.dirname(packageEntry), "..", "package.json"),
		};

		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.exit(0);
	});
}
