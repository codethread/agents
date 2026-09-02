#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import { isPrintInvocation, resolveRealPi } from "./pi-shim-core.ts";

type ChildOutcome = { code: number | null; signal: NodeJS.Signals | null };

async function spawnRealPi(executable: string, args: string[]): Promise<number> {
	const child = spawn(executable, args, { env: process.env, stdio: "inherit" });
	const outcome = await new Promise<ChildOutcome>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	if (outcome.signal) {
		const signalNumber = constants.signals[outcome.signal];
		return signalNumber === undefined ? 1 : 128 + signalNumber;
	}
	return outcome.code ?? 1;
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	if (isPrintInvocation(args)) {
		await import("./cli.ts");
		return typeof process.exitCode === "number" ? process.exitCode : 0;
	}
	const shimPath = fileURLToPath(import.meta.url);
	const realPi = await resolveRealPi(shimPath);
	if (typeof process.execve === "function") {
		process.execve(realPi, [realPi, ...args], process.env);
		throw new Error("process.execve unexpectedly returned");
	}
	return spawnRealPi(realPi, args);
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
