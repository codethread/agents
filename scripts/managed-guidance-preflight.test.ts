import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflight = join(root, "scripts/managed-guidance-preflight.mjs");
const executable = realpathSync(join(root, "node_modules/.bin/pi"));
const owner = realpathSync(join(root, "pi/extensions/system-prompt/index.ts"));
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
	const path = mkdtempSync(join(tmpdir(), "pi-guidance-preflight-"));
	temporaryDirectories.push(path);
	return path;
}

function files(path: string): string[] {
	return readdirSync(path, { recursive: true }).map(String).sort();
}

async function runCommand(command: string, args: string[], cwd = root): Promise<void> {
	await new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`${command} exited ${code}: ${stderr}`));
		});
	});
}

async function invoke(
	request: Record<string, unknown>,
	preflightEntrypoint = preflight,
): Promise<any> {
	return await new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [preflightEntrypoint], {
			cwd: root,
			env: { PATH: process.env.PATH },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) reject(new Error(`preflight exited ${code}: ${stderr}`));
			else resolvePromise(JSON.parse(stdout));
		});
		child.stdin.end(JSON.stringify(request));
	});
}

function world(settings?: Record<string, unknown>) {
	const base = temporaryDirectory();
	const cwd = join(base, "project");
	const workspace = join(base, "world/.millstrand");
	const agentDir = join(base, "agent");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	mkdirSync(workspace, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	if (settings) writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify(settings));
	return {
		base,
		cwd: realpathSync(cwd),
		workspace: realpathSync(workspace),
		agentDir: realpathSync(agentDir),
	};
}

function request(
	world: ReturnType<typeof world>,
	extraArgv: string[] = [],
): Record<string, unknown> {
	return {
		schema: "millstrand.agent-guidance-preflight/v1",
		harness: "pi",
		executable,
		mode: "headless",
		cwd: world.cwd,
		workspace: world.workspace,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: world.base,
			PI_CODING_AGENT_DIR: world.agentDir,
			MILLSTRAND_MANAGED_GUIDANCE: "must be scrubbed",
			MILLSTRAND_MANAGED_BOOTSTRAP: "must be scrubbed",
		},
		"extra-argv": extraArgv,
		resumes: false,
		model: "gpt-5.4",
		effort: "low",
	};
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("managed guidance Pi preflight", () => {
	it("returns no-model capability evidence for the exact 0.84.4 owned profile without writes", async () => {
		const fixture = world({ packages: [`+${root}`] });
		const before = files(fixture.base);
		const result = await invoke(request(fixture));
		expect(result).toMatchObject({
			schema: "millstrand.agent-guidance-preflight/v1",
			result: "capable",
			capability: {
				schema: "millstrand.agent-guidance-capability/v1",
				harness: "pi",
				"adapter-contract": "native-v1",
				"host-version": "0.84.4",
				"max-context-bytes": 65_536,
				"hook-fact": {
					"host-package": "@earendil-works/pi-coding-agent",
					"host-package-version": "0.84.4",
					"prompt-owner-entrypoint": owner,
					"system-prompt-options-contract": "owned-v1",
				},
			},
		});
		expect(result.capability["adapter-sha256"]).toMatch(/^[a-f0-9]{64}$/);
		expect(result.capability["launch-profile-sha256"]).toMatch(/^[a-f0-9]{64}$/);
		expect(files(fixture.base)).toEqual(before);
	});

	it("runs the no-model preflight from a pnpm-packed installation", async () => {
		const packDirectory = temporaryDirectory();
		await runCommand("pnpm", ["pack", "--pack-destination", packDirectory]);
		const archiveName = readdirSync(packDirectory).find((name) => name.endsWith(".tgz"));
		expect(archiveName).toBeDefined();
		const extractionDirectory = temporaryDirectory();
		await runCommand("tar", ["-xzf", join(packDirectory, archiveName!), "-C", extractionDirectory]);
		const packedRoot = realpathSync(join(extractionDirectory, "package"));
		const packedPreflight = join(packedRoot, "scripts/managed-guidance-preflight.mjs");
		const fixture = world({ packages: [`+${packedRoot}`] });

		const result = await invoke(request(fixture), packedPreflight);

		expect(result.result, JSON.stringify(result)).toBe("capable");
		expect(result.capability["hook-fact"]["prompt-owner-entrypoint"]).toBe(
			join(packedRoot, "pi/extensions/system-prompt/index.ts"),
		);
	});

	it("honors CLI extension selectors without enabling or inferring native", async () => {
		const fixture = world();
		const result = await invoke(request(fixture, ["--no-extensions", "--extension", owner]));
		expect(result.result).toBe("capable");
		expect(result.capability["hook-fact"].extensions).toHaveLength(1);
	});

	it("treats -ne as --no-extensions before applying explicit extension selectors", async () => {
		const disabled = world({ packages: [`+${root}`] });
		expect(await invoke(request(disabled, ["-ne"]))).toMatchObject({
			result: "legacy-required",
			code: "missing-hook",
		});

		const explicit = world({ packages: [`+${root}`] });
		const result = await invoke(request(explicit, ["-ne", "-e", owner]));
		expect(result.result).toBe("capable");
		expect(result.capability["hook-fact"].extensions).toHaveLength(1);
	});

	it("rejects missing, duplicate, changed-owner, and competing prompt profiles", async () => {
		const missing = world();
		expect((await invoke(request(missing))).code).toBe("missing-hook");

		const missingExplicit = world({ packages: [`+${root}`] });
		expect(
			await invoke(
				request(missingExplicit, ["--extension", join(missingExplicit.base, "missing.ts")]),
			),
		).toMatchObject({
			result: "legacy-required",
			code: "unverifiable-profile",
			diagnostic: expect.stringContaining("explicit extension path does not exist"),
		});

		const duplicate = world({ packages: [`+${root}`] });
		const secondOwner = join(duplicate.base, "second-owner.ts");
		writeFileSync(
			secondOwner,
			'// getOwnedSystemPromptOptions buildSystemPrompt\nexport default function x(pi) { pi.on("before_agent_start", () => ({ systemPrompt: "x" })); }\n',
		);
		expect((await invoke(request(duplicate, ["--extension", secondOwner]))).code).toBe(
			"duplicate-injector",
		);

		const changed = world();
		const changedOwner = join(changed.base, "changed-owner.ts");
		writeFileSync(
			changedOwner,
			'// getOwnedSystemPromptOptions buildSystemPrompt\nexport default function x(pi) { pi.on("before_agent_start", () => ({ systemPrompt: "x" })); }\n',
		);
		expect(
			(await invoke(request(changed, ["--no-extensions", "--extension", changedOwner]))).code,
		).toBe("untrusted-hook");

		const competing = world({ packages: [`+${root}`] });
		expect((await invoke(request(competing, ["--append-system-prompt=hostile"]))).code).toBe(
			"unverifiable-profile",
		);
	});

	it("rejects malformed and duplicate-key requests with one bounded response", async () => {
		const fixture = world({ packages: [`+${root}`] });
		const encoded = JSON.stringify(request(fixture)).replace(/}$/, ',"harness":"codex"}');
		const response = await new Promise<string>((resolvePromise, reject) => {
			const child = spawn(process.execPath, [preflight], {
				cwd: root,
				stdio: ["pipe", "pipe", "pipe"],
			});
			let stdout = "";
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => (stdout += chunk));
			child.on("error", reject);
			child.on("close", () => resolvePromise(stdout));
			child.stdin.end(encoded);
		});
		expect(response.trim().split("\n")).toHaveLength(1);
		expect(Buffer.byteLength(response)).toBeLessThan(1024);
		expect(JSON.parse(response).code).toBe("unverifiable-profile");
	});
});
