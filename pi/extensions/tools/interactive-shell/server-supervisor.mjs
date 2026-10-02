import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

// This detached process owns both the directory and the foreground tmux server.
// No resources are created before the IPC disconnect handler is installed.
let directory;
let server;
let readinessTimer;
let shutdownTimer;
let stopping = false;
let exitCode = 0;

function finish(code) {
	clearInterval(readinessTimer);
	clearTimeout(shutdownTimer);
	if (directory) rmSync(directory, { recursive: true, force: true });
	process.exit(code);
}

function stop() {
	if (stopping) return;
	stopping = true;
	clearInterval(readinessTimer);
	if (!server?.pid) return finish(exitCode);
	server.kill("SIGTERM");
	shutdownTimer = setTimeout(() => server.kill("SIGKILL"), 5000);
}

process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);

try {
	if (!process.connected) throw new Error("interactive shell supervisor requires IPC");
	// Keep Unix socket paths short even on macOS, whose TMPDIR can be long.
	directory = mkdtempSync("/tmp/pi-shell-");
	const socketPath = join(directory, "tmux.sock");
	server = spawn("tmux", ["-D", "-S", socketPath, "-f", "/dev/null"], {
		stdio: "ignore",
	});
	server.once("error", (error) => {
		console.error(`interactive shell server: ${error.message}`);
		finish(1);
	});
	server.once("exit", () => finish(stopping ? exitCode : 1));

	const deadline = Date.now() + 5000;
	readinessTimer = setInterval(() => {
		if (existsSync(socketPath)) {
			clearInterval(readinessTimer);
			if (process.connected) process.send({ socketPath }, (error) => error && stop());
			else stop();
		} else if (Date.now() >= deadline) {
			console.error("interactive shell server did not create its socket");
			exitCode = 1;
			stop();
		}
	}, 10);
} catch (error) {
	console.error(error);
	exitCode = 1;
	stop();
}
