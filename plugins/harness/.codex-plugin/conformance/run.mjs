#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runnerPath = fileURLToPath(import.meta.url);
const conformanceRoot = dirname(runnerPath);
const pluginRoot = resolve(conformanceRoot, "../..");
const payloadRoot = join(conformanceRoot, "payloads");
const identityHook = join(pluginRoot, ".codex-plugin/hooks/identity.sh");
const fakeStrand = join(conformanceRoot, "fake-strand.sh");
const expectedCodexVersion = "codex-cli 0.154.0";
const schemaRoot = join(conformanceRoot, "schemas");
const inputSchemas = {
	SessionStart: JSON.parse(
		readFileSync(join(schemaRoot, "session-start.command.input.schema.json"), "utf8"),
	),
	SubagentStart: JSON.parse(
		readFileSync(join(schemaRoot, "subagent-start.command.input.schema.json"), "utf8"),
	),
};
const outputSchemas = {
	SessionStart: JSON.parse(
		readFileSync(join(schemaRoot, "session-start.command.output.schema.json"), "utf8"),
	),
	SubagentStart: JSON.parse(
		readFileSync(join(schemaRoot, "subagent-start.command.output.schema.json"), "utf8"),
	),
};
const temporaryDirectories = [];
const activeChildren = new Set();
let environmentRoot;

function temporaryDirectory(prefix) {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

async function waitForFile(path, timeout = 2_000) {
	const deadline = Date.now() + timeout;
	while (!existsSync(path)) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${path}`);
		await new Promise((resolvePromise) => setImmediate(resolvePromise));
	}
}

function trackChild(child) {
	activeChildren.add(child);
	child.once("close", () => activeChildren.delete(child));
	return child;
}

function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

function terminateProcessTree(child) {
	if (child.pid === undefined) return;
	try {
		process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}

function cleanup() {
	for (const child of activeChildren) terminateProcessTree(child);
	activeChildren.clear();
	while (temporaryDirectories.length > 0) {
		rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
	}
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	const handler = () => {
		process.off(signal, handler);
		try {
			cleanup();
		} finally {
			process.kill(process.pid, signal);
		}
	};
	process.on(signal, handler);
}

function run(command, args, { input = "", env = process.env, timeout = 10_000, onSpawn } = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = trackChild(
			spawn(command, args, {
				detached: process.platform !== "win32",
				env,
				cwd: env.HOME,
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		onSpawn?.(child);
		let stdout = "";
		let stderr = "";
		let terminalError;
		const stopWithError = (error) => {
			if (terminalError) return;
			terminalError = error;
			terminateProcessTree(child);
		};
		const timer = setTimeout(() => {
			stopWithError(new Error(`${command} timed out after ${timeout}ms`));
		}, timeout);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (stdout.length > 1_000_000) {
				stopWithError(new Error(`${command} stdout was unbounded`));
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			if (stderr.length > 1_000_000) {
				stopWithError(new Error(`${command} stderr was unbounded`));
			}
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			if (terminalError) reject(terminalError);
			else resolvePromise({ code, signal, stdout, stderr });
		});
		child.stdin.end(input);
	});
}

function parseJsonLines(text, label) {
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch (error) {
				throw new Error(`${label} contains invalid JSON: ${error.message}`);
			}
		});
}

function parseSingleJsonLine(text, label) {
	const lines = parseJsonLines(text, label);
	assert.equal(lines.length, 1, `${label} must emit exactly one JSON line`);
	return lines[0];
}

function assertMatchesSchema(value, schema, rootSchema, label) {
	if (schema.$ref) {
		const definitionName = schema.$ref.replace("#/definitions/", "");
		assertMatchesSchema(value, rootSchema.definitions[definitionName], rootSchema, label);
		return;
	}
	if (schema.allOf) {
		for (const member of schema.allOf) assertMatchesSchema(value, member, rootSchema, label);
		return;
	}
	if (schema.const !== undefined) assert.equal(value, schema.const, label);
	if (schema.enum) assert.ok(schema.enum.includes(value), `${label} is outside its enum`);
	if (Array.isArray(schema.type)) {
		const matches = schema.type.some((type) =>
			type === "null" ? value === null : typeof value === type,
		);
		assert.ok(matches, `${label} has the wrong type`);
	} else if (schema.type === "object") {
		assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
		for (const required of schema.required ?? []) {
			assert.ok(required in value, `${label}.${required} is required`);
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(value)) {
				assert.ok(key in schema.properties, `${label}.${key} is not in the pinned schema`);
			}
		}
		for (const [key, member] of Object.entries(schema.properties ?? {})) {
			if (key in value) assertMatchesSchema(value[key], member, rootSchema, `${label}.${key}`);
		}
	} else if (schema.type) {
		assert.equal(typeof value, schema.type, label);
	}
}

function assertHookOutput(output, eventName) {
	assertMatchesSchema(
		output,
		outputSchemas[eventName],
		outputSchemas[eventName],
		`${eventName} output`,
	);
	assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
	assert.equal(output.hookSpecificOutput.hookEventName, eventName);
	assert.equal(typeof output.hookSpecificOutput.additionalContext, "string");
	assert.ok(output.hookSpecificOutput.additionalContext.length > 0);
}

function fixtureEnvironment(extra = {}) {
	// Only PATH comes from the caller: no credentials, shared workspace, shell
	// startup scripts, or ambient fake modes may influence a disposable replay.
	environmentRoot ??= temporaryDirectory("codex-hook-environment-");
	const env = {
		PATH: process.env.PATH,
		LANG: "C.UTF-8",
		HOME: join(environmentRoot, "home"),
		CODEX_HOME: join(environmentRoot, "codex"),
		XDG_CONFIG_HOME: join(environmentRoot, "config"),
		XDG_STATE_HOME: join(environmentRoot, "state"),
		XDG_CACHE_HOME: join(environmentRoot, "cache"),
		XDG_RUNTIME_DIR: join(environmentRoot, "runtime"),
		TMPDIR: join(environmentRoot, "tmp"),
		PLUGIN_ROOT: pluginRoot,
		...extra,
	};
	for (const name of [
		"HOME",
		"CODEX_HOME",
		"XDG_CONFIG_HOME",
		"XDG_STATE_HOME",
		"XDG_CACHE_HOME",
		"XDG_RUNTIME_DIR",
		"TMPDIR",
	]) {
		mkdirSync(env[name], { recursive: true });
	}
	return env;
}

async function checkHostKillRecovery(payloadText) {
	const directory = temporaryDirectory("codex-hook-sigkill-recovery-");
	const stateDirectory = join(directory, "state");
	const gate = join(directory, "gate");
	const ready = join(directory, "ready");
	const fakePidFile = join(directory, "fake.pid");
	const logPath = join(directory, "fake-strand.jsonl");
	mkdirSync(stateDirectory);
	const fifo = await run("mkfifo", [gate], { env: fixtureEnvironment() });
	assert.equal(fifo.code, 0, fifo.stderr);

	const environment = fixtureEnvironment({
		XDG_STATE_HOME: stateDirectory,
		TMPDIR: directory,
		MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
		FAKE_STRAND_LOG: logPath,
	});
	const child = trackChild(
		spawn("bash", [identityHook], {
			detached: true,
			env: {
				...environment,
				FAKE_STRAND_MODE: "hold",
				FAKE_STRAND_GATE: gate,
				FAKE_STRAND_READY: ready,
				FAKE_STRAND_PID_FILE: fakePidFile,
			},
			stdio: ["pipe", "pipe", "pipe"],
		}),
	);
	child.stdin.end(payloadText);
	await waitForFile(ready);
	await waitForFile(fakePidFile);
	const fakePid = Number.parseInt(readFileSync(fakePidFile, "utf8"), 10);
	assert.equal(processExists(fakePid), true);
	const closed = new Promise((resolvePromise) =>
		child.once("close", (code, closeSignal) => resolvePromise({ code, closeSignal })),
	);
	process.kill(-child.pid, "SIGKILL");
	assert.deepEqual(await closed, { code: null, closeSignal: "SIGKILL" });
	assert.equal(processExists(fakePid), false, "host SIGKILL must terminate the Strand child");

	const recovered = await run("bash", [identityHook], {
		input: payloadText,
		env: environment,
	});
	assert.equal(recovered.code, 0, recovered.stderr);
	assertHookOutput(
		parseSingleJsonLine(recovered.stdout, "post-SIGKILL recovery response"),
		"SessionStart",
	);
	assert.equal(
		parseJsonLines(readFileSync(logPath, "utf8"), "post-SIGKILL fake calls").length,
		2,
		"a healthy replay must reach Strand after the abandoned OS lock is released",
	);
}

async function checkPayloadReplay() {
	const cases = [
		["session-start-startup.json", "SessionStart", "startup"],
		["session-start-resume.json", "SessionStart", "resume"],
		["session-start-clear.json", "SessionStart", "clear"],
		["session-start-compact.json", "SessionStart", "compact"],
		["subagent-start.json", "SubagentStart", null],
	];

	for (const [fileName, eventName, source] of cases) {
		const payloadText = readFileSync(join(payloadRoot, fileName), "utf8");
		const payload = JSON.parse(payloadText);
		assertMatchesSchema(payload, inputSchemas[eventName], inputSchemas[eventName], fileName);
		assert.equal(payload.hook_event_name, eventName);
		assert.equal(typeof payload.session_id, "string");
		assert.equal(typeof payload.cwd, "string");
		if (source === null) {
			assert.equal(typeof payload.turn_id, "string");
			assert.equal(typeof payload.agent_id, "string");
			assert.equal(typeof payload.agent_type, "string");
			assert.equal("source" in payload, false);
		} else {
			assert.equal(payload.source, source);
			assert.equal("agent_id" in payload, false);
		}

		const logDirectory = temporaryDirectory("codex-hook-replay-");
		const logPath = join(logDirectory, "fake-strand.jsonl");
		const inheritedChildHints =
			eventName === "SubagentStart"
				? {
						MILLSTRAND_AGENT_ID: "inherited-parent-must-not-be-used",
						MILLSTRAND_RUN_ID: "inherited-run",
						MILLSTRAND_BOOTSTRAP_V1: "inherited-bootstrap",
						MILLSTRAND_RESERVATION_ID: "inherited-reservation",
					}
				: {};
		const result = await run("bash", [identityHook], {
			input: payloadText,
			env: fixtureEnvironment({
				MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
				FAKE_STRAND_LOG: logPath,
				FAKE_STRAND_RESULT: source === "resume" ? "recovered" : "minted",
				TMPDIR: logDirectory,
				...inheritedChildHints,
			}),
		});
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stderr, "");
		const output = parseSingleJsonLine(result.stdout, fileName);
		assertHookOutput(output, eventName);
		assert.deepEqual(
			readdirSync(logDirectory),
			["fake-strand.jsonl"],
			"hook must clean bounded response files",
		);

		const fakeCalls = parseJsonLines(readFileSync(logPath, "utf8"), `${fileName} fake calls`);
		assert.equal(fakeCalls.length, eventName === "SubagentStart" ? 2 : 1);
		for (const fakeCall of fakeCalls) {
			assert.equal(fakeCall.cwd, payload.cwd);
			assert.equal(fakeCall.timeout, "3s");
			assert.equal(fakeCall.workspace, "");
			assert.equal(fakeCall.model, payload.model);
			assert.equal(fakeCall.managed_environment_present, false);
		}

		if (eventName === "SubagentStart") {
			const [parentCall, childCall] = fakeCalls;
			assert.equal(parentCall.native_session_id, payload.session_id);
			assert.equal(parentCall.parent_identity, "");
			assert.equal(
				childCall.native_session_id,
				`codex-child:v1:${Buffer.from(payload.session_id).toString("base64url")}:${Buffer.from(payload.agent_id).toString("base64url")}`,
			);
			assert.equal(childCall.parent_identity, "fixture-root-identity");
			assert.match(output.hookSpecificOutput.additionalContext, /fixture-child-identity/);
			assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /fixture-root-identity/);
		} else {
			assert.equal(fakeCalls[0].native_session_id, payload.session_id);
			assert.match(output.hookSpecificOutput.additionalContext, /fixture-root-identity/);
		}

		assert.match(
			output.hookSpecificOutput.additionalContext,
			/Run Strand from the Codex session working directory/,
		);
		if (source === "startup") assert.match(payload.cwd, /linked-worktree/);
	}

	const payloadText = readFileSync(join(payloadRoot, "session-start-startup.json"), "utf8");
	const explicitDirectory = temporaryDirectory("codex-hook-explicit-workspace-");
	const explicitLog = join(explicitDirectory, "fake-strand.jsonl");
	const explicitWorkspace = "/configured workspace/.millstrand";
	const explicit = await run("bash", [identityHook], {
		input: payloadText,
		env: fixtureEnvironment({
			MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
			MILLSTRAND_CODEX_WORKSPACE: explicitWorkspace,
			FAKE_STRAND_LOG: explicitLog,
			TMPDIR: explicitDirectory,
		}),
	});
	assert.equal(explicit.code, 0, explicit.stderr);
	const explicitOutput = parseSingleJsonLine(explicit.stdout, "explicit workspace response");
	assertHookOutput(explicitOutput, "SessionStart");
	assert.equal(
		parseSingleJsonLine(readFileSync(explicitLog, "utf8"), "explicit call").workspace,
		explicitWorkspace,
	);
	assert.match(explicitOutput.hookSpecificOutput.additionalContext, /configured workspace/);
	assert.match(explicitOutput.hookSpecificOutput.additionalContext, /`--workspace`/);

	const legacyDirectory = temporaryDirectory("codex-hook-legacy-");
	const legacyLog = join(legacyDirectory, "fake-strand.jsonl");
	const legacy = await run("bash", [identityHook], {
		input: payloadText,
		env: fixtureEnvironment({
			MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
			MILLSTRAND_AGENT_ID: "legacy-identity",
			MILLSTRAND_RUN_ID: "legacy-run",
			MILLSTRAND_WORKSPACE: "/legacy/.millstrand",
			FAKE_STRAND_LOG: legacyLog,
			TMPDIR: legacyDirectory,
		}),
	});
	assert.equal(legacy.code, 0, legacy.stderr);
	assert.equal(legacy.stdout, "", "legacy managed roots must not inject context");
	assert.equal(existsSync(legacyLog), false, "legacy managed roots must not mint identity");

	const duplicateDirectory = temporaryDirectory("codex-hook-duplicate-");
	const duplicateGate = join(duplicateDirectory, "gate");
	const duplicateReady = join(duplicateDirectory, "ready");
	const duplicateLog = join(duplicateDirectory, "fake-strand.jsonl");
	const fifo = await run("mkfifo", [duplicateGate], { env: fixtureEnvironment() });
	assert.equal(fifo.code, 0, fifo.stderr);
	const duplicateEnvironment = fixtureEnvironment({
		MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
		FAKE_STRAND_LOG: duplicateLog,
		TMPDIR: duplicateDirectory,
	});
	const firstInjector = run("bash", [identityHook], {
		input: payloadText,
		env: {
			...duplicateEnvironment,
			FAKE_STRAND_MODE: "hold",
			FAKE_STRAND_GATE: duplicateGate,
			FAKE_STRAND_READY: duplicateReady,
		},
	});
	await waitForFile(duplicateReady);
	const secondInjector = await run("bash", [identityHook], {
		input: payloadText,
		env: duplicateEnvironment,
	});
	assert.match(
		parseSingleJsonLine(secondInjector.stdout, "duplicate injector response").systemMessage,
		/Duplicate Millstrand identity injector/,
	);
	assert.equal(
		parseJsonLines(readFileSync(duplicateLog, "utf8"), "duplicate fake calls").length,
		1,
	);
	writeFileSync(duplicateGate, "release\n");
	const firstInjectorResult = await firstInjector;
	assert.equal(firstInjectorResult.code, 0, firstInjectorResult.stderr);
	assertHookOutput(
		parseSingleJsonLine(firstInjectorResult.stdout, "first duplicate injector response"),
		"SessionStart",
	);

	const staggeredDirectory = temporaryDirectory("codex-hook-staggered-duplicate-");
	const staggeredLog = join(staggeredDirectory, "fake-strand.jsonl");
	const canonicalEnvironment = fixtureEnvironment({
		MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
		FAKE_STRAND_LOG: staggeredLog,
		TMPDIR: staggeredDirectory,
	});
	const canonicalInjector = await run("bash", [identityHook], {
		input: payloadText,
		env: canonicalEnvironment,
	});
	assertHookOutput(
		parseSingleJsonLine(canonicalInjector.stdout, "canonical injector response"),
		"SessionStart",
	);
	const nonPackagedEnvironment = { ...canonicalEnvironment };
	delete nonPackagedEnvironment.PLUGIN_ROOT;
	const staggeredDuplicate = await run("bash", [identityHook], {
		input: payloadText,
		env: nonPackagedEnvironment,
	});
	assert.match(
		parseSingleJsonLine(staggeredDuplicate.stdout, "staggered duplicate response").systemMessage,
		/Duplicate or non-packaged Millstrand identity injector configuration/,
	);
	assert.equal(
		parseJsonLines(readFileSync(staggeredLog, "utf8"), "staggered fake calls").length,
		1,
		"a staggered non-plugin registration must not reach Strand after the canonical handler exits",
	);

	for (const mode of [
		"failure",
		"no-workspace",
		"invalid-binding",
		"flood",
		"oversized",
		"invalid-json",
		"missing-context",
		"empty-context",
		"multiple-responses",
	]) {
		const failureDirectory = temporaryDirectory("codex-hook-failure-");
		const result = await run("bash", [identityHook], {
			input: payloadText,
			env: fixtureEnvironment({
				MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
				FAKE_STRAND_MODE: mode,
				TMPDIR: failureDirectory,
			}),
		});
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.deepEqual(readdirSync(failureDirectory), [], `${mode} must clean response files`);
		assert.ok(Buffer.byteLength(result.stdout) < 512, `${mode} output was not bounded`);
		const output = parseSingleJsonLine(result.stdout, `${mode} response`);
		assertMatchesSchema(
			output,
			outputSchemas.SessionStart,
			outputSchemas.SessionStart,
			`${mode} output`,
		);
		assert.deepEqual(Object.keys(output), ["continue", "systemMessage"]);
		assert.equal(output.continue, true);
		assert.match(output.systemMessage, /unbound|required context was not injected/);
	}

	const missingStrand = await run("bash", [identityHook], {
		input: payloadText,
		env: fixtureEnvironment({ MILLSTRAND_CODEX_STRAND_BIN: "/missing/strand" }),
	});
	assert.match(
		parseSingleJsonLine(missingStrand.stdout, "missing Strand response").systemMessage,
		/cannot execute Strand/,
	);

	const malformed = await run("bash", [identityHook], {
		input: '{"hook_event_name":"SessionStart","session_id":""}',
		env: fixtureEnvironment({ MILLSTRAND_CODEX_STRAND_BIN: fakeStrand }),
	});
	assert.match(
		parseSingleJsonLine(malformed.stdout, "malformed payload response").systemMessage,
		/invalid SessionStart payload/,
	);

	if (process.platform !== "win32") await checkHostKillRecovery(payloadText);

	const timeoutDirectory = temporaryDirectory("codex-hook-timeout-");
	await assert.rejects(
		run("bash", [identityHook], {
			input: payloadText,
			timeout: 250,
			env: fixtureEnvironment({
				MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
				FAKE_STRAND_MODE: "hang",
				TMPDIR: timeoutDirectory,
			}),
		}),
		/timed out/,
	);
	rmSync(timeoutDirectory, { recursive: true, force: true });
	assert.equal(existsSync(timeoutDirectory), false, "forced timeout artifacts must be removable");
}

function writeConfig(codexHome, enabled, hooksEnabled = true) {
	writeFileSync(
		join(codexHome, "config.toml"),
		`[features]\nplugins = true\nremote_plugin = false\nhooks = ${hooksEnabled}\n\n[plugins."harness@agents"]\nenabled = ${enabled}\n`,
	);
}

function createCodexWorld({ enabled = true, hooksEnabled = true } = {}) {
	const codexHome = temporaryDirectory("codex-hook-world-");
	const home = join(codexHome, "home");
	const installedPlugin = join(codexHome, "plugins/cache/agents/harness/local");
	mkdirSync(home, { recursive: true });
	mkdirSync(dirname(installedPlugin), { recursive: true });
	cpSync(pluginRoot, installedPlugin, { recursive: true });
	writeConfig(codexHome, enabled, hooksEnabled);
	const cwd = join(codexHome, "project");
	mkdirSync(cwd);
	return { codexHome, home, installedPlugin, cwd };
}

async function listHooks(world, cwd = world.cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = trackChild(
			spawn("codex", ["app-server", "--stdio"], {
				detached: process.platform !== "win32",
				env: fixtureEnvironment({
					CODEX_HOME: world.codexHome,
					HOME: world.home,
					CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: "1",
				}),
				cwd: world.cwd,
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
		let stdout = "";
		let stderr = "";
		let response;
		let terminalError;
		let initialized = false;
		let outputBytes = 0;
		const stopWithError = (error) => {
			if (terminalError) return;
			terminalError = error;
			terminateProcessTree(child);
		};
		const timer = setTimeout(() => {
			stopWithError(new Error(`codex app-server hooks/list timed out; stderr: ${stderr}`));
		}, 15_000);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			outputBytes += Buffer.byteLength(chunk);
			if (outputBytes > 1_000_000) {
				stopWithError(new Error("codex app-server output was unbounded"));
			}
		});
		child.stdout.on("data", (chunk) => {
			if (terminalError) return;
			stdout += chunk;
			outputBytes += Buffer.byteLength(chunk);
			if (outputBytes > 1_000_000) {
				stopWithError(new Error("codex app-server output was unbounded"));
				return;
			}
			try {
				for (;;) {
					const newline = stdout.indexOf("\n");
					if (newline < 0) break;
					const line = stdout.slice(0, newline);
					stdout = stdout.slice(newline + 1);
					if (line.length === 0) continue;
					const message = JSON.parse(line);
					if (message.id === 1 && !initialized) {
						initialized = true;
						child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
						child.stdin.write(
							`${JSON.stringify({ id: 2, method: "hooks/list", params: { cwds: [cwd] } })}\n`,
						);
					}
					if (message.id === 2) {
						if (message.error) {
							stopWithError(new Error(`hooks/list failed: ${JSON.stringify(message.error)}`));
							return;
						}
						response = message.result;
						child.stdin.end();
					}
				}
			} catch (error) {
				stopWithError(error);
			}
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (terminalError) {
				reject(terminalError);
				return;
			}
			if (response === undefined) {
				reject(new Error(`codex app-server exited ${code}; stderr: ${stderr}`));
				return;
			}
			if (code !== 0) {
				reject(new Error(`codex app-server exited ${code}; stderr: ${stderr}`));
				return;
			}
			resolvePromise(response);
		});

		child.stdin.write(
			`${JSON.stringify({
				id: 1,
				method: "initialize",
				params: {
					clientInfo: { name: "codex-hook-conformance", version: "1" },
					capabilities: { experimentalApi: true },
				},
			})}\n`,
		);
	});
}

function onlyEntry(response) {
	assert.equal(response.data.length, 1);
	return response.data[0];
}

async function checkCliDiscovery() {
	const version = await run("codex", ["--version"], { env: fixtureEnvironment() });
	assert.equal(version.code, 0, version.stderr);
	assert.equal(version.stdout.trim(), expectedCodexVersion);

	const manifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
	assert.equal(manifest.hooks, "./.codex-plugin/hooks/hooks.json");

	const active = createCodexWorld();
	const activeEntry = onlyEntry(await listHooks(active));
	assert.deepEqual(activeEntry.hooks.map((hook) => hook.eventName).sort(), [
		"postToolUse",
		"sessionStart",
		"sessionStart",
		"stop",
		"subagentStart",
		"userPromptSubmit",
	]);
	const identityHooks = activeEntry.hooks.filter((hook) =>
		hook.command.endsWith('/.codex-plugin/hooks/identity.sh"'),
	);
	assert.equal(identityHooks.length, 2);
	assert.deepEqual(identityHooks.map((hook) => hook.eventName).sort(), [
		"sessionStart",
		"subagentStart",
	]);
	for (const hook of identityHooks) {
		assert.equal(hook.source, "plugin");
		assert.equal(hook.pluginId, "harness@agents");
		assert.equal(hook.trustStatus, "untrusted");
		assert.equal(hook.timeoutSec, 8);
		assert.equal(hook.additionalContextLimit, 4096);
		assert.match(hook.sourcePath, /\.codex-plugin\/hooks\/hooks\.json$/);
	}
	const sessionStart = identityHooks.find((hook) => hook.eventName === "sessionStart");

	writeFileSync(
		join(active.codexHome, "config.toml"),
		`${readFileSync(join(active.codexHome, "config.toml"), "utf8")}\n[hooks.state."${sessionStart.key}"]\ntrusted_hash = "${sessionStart.currentHash}"\n`,
	);
	const trustedEntry = onlyEntry(await listHooks(active));
	assert.equal(
		trustedEntry.hooks.find((hook) => hook.key === sessionStart.key).trustStatus,
		"trusted",
	);

	const disabledFeature = createCodexWorld({ hooksEnabled: false });
	assert.deepEqual(onlyEntry(await listHooks(disabledFeature)).hooks, []);

	const disabledPlugin = createCodexWorld({ enabled: false });
	assert.deepEqual(onlyEntry(await listHooks(disabledPlugin)).hooks, []);

	const missing = createCodexWorld();
	const missingManifestPath = join(missing.installedPlugin, ".codex-plugin/plugin.json");
	const missingManifest = JSON.parse(readFileSync(missingManifestPath, "utf8"));
	missingManifest.hooks = "./.codex-plugin/hooks/missing.json";
	writeFileSync(missingManifestPath, `${JSON.stringify(missingManifest, null, "\t")}\n`);
	const missingEntry = onlyEntry(await listHooks(missing));
	assert.deepEqual(missingEntry.hooks, []);
	assert.equal(missingEntry.warnings.length, 1);
	assert.match(missingEntry.warnings[0], /failed to read plugin hooks config .*missing\.json/);

	const duplicate = createCodexWorld();
	const command = `bash "${join(duplicate.installedPlugin, ".codex-plugin/hooks/identity.sh")}"`;
	writeFileSync(
		join(duplicate.codexHome, "hooks.json"),
		`${JSON.stringify(
			{
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command,
									additionalContextLimit: 1024,
								},
							],
						},
					],
				},
			},
			null,
			"\t",
		)}\n`,
	);
	const duplicateEntry = onlyEntry(await listHooks(duplicate));
	const duplicateSessionHooks = duplicateEntry.hooks.filter(
		(hook) =>
			hook.eventName === "sessionStart" &&
			hook.command.endsWith('/.codex-plugin/hooks/identity.sh"'),
	);
	assert.equal(
		duplicateSessionHooks.length,
		2,
		"duplicate injectors must be diagnosed before startup",
	);
	assert.deepEqual(duplicateSessionHooks.map((hook) => hook.source).sort(), ["plugin", "user"]);
	assert.equal(
		duplicateSessionHooks.find((hook) => hook.source === "user").additionalContextLimit,
		1024,
	);

	const linkedEntry = onlyEntry(await listHooks(active, "/workspace/project-linked-worktree"));
	assert.equal(linkedEntry.cwd, "/workspace/project-linked-worktree");
}

async function holdInterruptProbe() {
	const directory = temporaryDirectory("codex-hook-interrupt-");
	writeFileSync(join(directory, "artifact"), "must be removed\n");
	const payloadText = readFileSync(join(payloadRoot, "session-start-startup.json"), "utf8");
	await run("bash", [identityHook], {
		input: payloadText,
		timeout: 120_000,
		env: fixtureEnvironment({
			MILLSTRAND_CODEX_STRAND_BIN: fakeStrand,
			FAKE_STRAND_MODE: "hang",
			TMPDIR: directory,
		}),
		onSpawn(child) {
			process.stdout.write(`${JSON.stringify({ childPid: child.pid, directory })}\n`);
		},
	});
}

try {
	if (process.argv[2] === "--interrupt-probe") {
		await holdInterruptProbe();
	} else {
		await checkPayloadReplay();
		await checkCliDiscovery();
		console.log(`Codex hook conformance passed (${expectedCodexVersion}; CLI-only, no model).`);
	}
} finally {
	cleanup();
}
