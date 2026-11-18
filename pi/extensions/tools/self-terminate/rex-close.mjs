import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const target = JSON.parse(process.argv[2]);
const blocksSchema = z.object({
	blocks: z.array(
		z.object({
			block_id: z.string().min(1),
			window_id: z.string().min(1).optional(),
		}),
	),
});

// The parent intentionally keeps IPC connected through every shutdown hook.
// EOF means Pi has exited; no sleep or PID polling can race its cleanup.
process.once("disconnect", async () => {
	try {
		const { stdout } = await rex(["block", "ls", "-s", target.sessionId, "--json"]);
		const { blocks } = blocksSchema.parse(JSON.parse(stdout));
		const remaining = blocks.filter((block) => block.window_id === target.windowId);
		if (remaining.length === 0) return; // Rex already removed the tab on process exit.
		if (remaining.length !== 1 || remaining[0].block_id !== target.blockId) {
			throw new Error("Rex tab changed; refusing to close unrelated panes");
		}
		await rex(["window", "close", "-s", target.sessionId, target.windowId]);
		console.log(`Closed Rex tab ${target.windowId}`);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
});
process.send("ready");

async function rex(args) {
	return execFileAsync("rex", ["--autostart=false", "--timeout", "3s", ...args], {
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	});
}
