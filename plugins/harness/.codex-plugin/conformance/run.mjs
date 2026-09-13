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

const conformanceRoot = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(conformanceRoot, "../..");
const payloadRoot = join(conformanceRoot, "payloads");
const referenceHook = join(conformanceRoot, "reference-hook.sh");
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
let environmentRoot;

function temporaryDirectory(prefix) {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function terminateProcessTree(child) {
	if (child.pid === undefined) return;
	try {
		process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
}

function run(command, args, { input = "", env = process.env, timeout = 10_000 } = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			detached: process.platform !== "win32",
			env,
			cwd: env.HOME,
			stdio: ["pipe", "pipe", "pipe"],
		});
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

function parseSingleJsonLine(text, label) {
	const lines = text.trim().split("\n");
	assert.equal(lines.length, 1, `${label} must emit exactly one JSON line`);
	return JSON.parse(lines[0]);
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
		TMPDIR: join(environmentRoot, "tmp"),
		...extra,
	};
	for (const name of Object.keys(env)) {
		if (name.startsWith("MILLSTRAND_")) delete env[name];
	}
	for (const name of [
		"HOME",
		"CODEX_HOME",
		"XDG_CONFIG_HOME",
		"XDG_STATE_HOME",
		"XDG_CACHE_HOME",
		"TMPDIR",
	]) {
		mkdirSync(env[name], { recursive: true });
	}
	return env;
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
			assert.equal(typeof payload.agent_id, "string");
			assert.equal("source" in payload, false);
		} else {
			assert.equal(payload.source, source);
			assert.equal("agent_id" in payload, false);
		}

		const logDirectory = temporaryDirectory("codex-hook-replay-");
		const logPath = join(logDirectory, "fake-strand.jsonl");
		const result = await run("bash", [referenceHook], {
			input: payloadText,
			env: fixtureEnvironment({
				STRAND_BIN: fakeStrand,
				FAKE_STRAND_LOG: logPath,
				TMPDIR: logDirectory,
				// Exercise removal even when the suite's caller is unmanaged.
				MILLSTRAND_AGENT_ID: "inherited-parent-must-not-be-used",
				MILLSTRAND_RUN_ID: "inherited-run",
				MILLSTRAND_BOOTSTRAP_V1: "inherited-bootstrap",
				MILLSTRAND_RESERVATION_ID: "",
				MILLSTRAND_WORKSPACE: "/must-not-access-shared-world",
			}),
		});
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stderr, "");
		const output = parseSingleJsonLine(result.stdout, fileName);
		assertHookOutput(output, eventName);
		assert.deepEqual(
			readdirSync(logDirectory),
			["fake-strand.jsonl"],
			"hook must clean capture files",
		);

		const fakeCall = parseSingleJsonLine(readFileSync(logPath, "utf8"), `${fileName} fake call`);
		assert.equal(fakeCall.request.session_id, payload.session_id);
		assert.equal(fakeCall.request.cwd, payload.cwd);
		assert.equal(fakeCall.request.source, source);
		assert.equal(fakeCall.request.agent_id, payload.agent_id ?? null);
		assert.equal(fakeCall.managed_environment_present, false);
		assert.equal(fakeCall.managed_state, "none");
		assert.equal(
			output.hookSpecificOutput.additionalContext,
			fakeCall.returned_context,
			"context must come verbatim from Strand, not a fallback identity",
		);

		if (source === "startup") {
			assert.match(payload.cwd, /linked-worktree/);
			assert.match(
				output.hookSpecificOutput.additionalContext,
				/\/workspace\/project\/\.millstrand/,
			);
		}
	}

	for (const mode of [
		"failure",
		"flood",
		"oversized",
		"invalid-json",
		"missing-context",
		"empty-context",
		"multiple-responses",
	]) {
		const payloadText = readFileSync(join(payloadRoot, "session-start-startup.json"), "utf8");
		const failureDirectory = temporaryDirectory("codex-hook-failure-");
		const result = await run("bash", [referenceHook], {
			input: payloadText,
			env: fixtureEnvironment({
				STRAND_BIN: fakeStrand,
				FAKE_STRAND_MODE: mode,
				CODEX_FIXTURE_CONTEXT_MAX_BYTES: "4096",
				TMPDIR: failureDirectory,
			}),
		});
		assert.equal(result.code, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.deepEqual(readdirSync(failureDirectory), [], `${mode} must clean capture files`);
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
		assert.match(
			output.systemMessage,
			mode === "failure" || mode === "flood"
				? /unavailable/
				: mode === "oversized"
					? /exceeds/
					: /invalid response/,
		);
	}

	const timeoutDirectory = temporaryDirectory("codex-hook-timeout-");
	const payloadText = readFileSync(join(payloadRoot, "session-start-startup.json"), "utf8");
	await assert.rejects(
		run("bash", [referenceHook], {
			input: payloadText,
			timeout: 250,
			env: fixtureEnvironment({
				STRAND_BIN: fakeStrand,
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
		const child = spawn("codex", ["app-server", "--stdio"], {
			detached: process.platform !== "win32",
			env: fixtureEnvironment({
				CODEX_HOME: world.codexHome,
				HOME: world.home,
				CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG: "1",
			}),
			cwd: world.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
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
		"stop",
		"userPromptSubmit",
	]);
	const sessionStart = activeEntry.hooks.find((hook) => hook.eventName === "sessionStart");
	assert.equal(sessionStart.source, "plugin");
	assert.equal(sessionStart.pluginId, "harness@agents");
	assert.equal(sessionStart.trustStatus, "untrusted");
	assert.match(sessionStart.sourcePath, /\.codex-plugin\/hooks\/hooks\.json$/);

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
	const command = `bash "${join(duplicate.installedPlugin, ".codex-plugin/hooks/capture.sh")}"`;
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
			hook.command.endsWith('/.codex-plugin/hooks/capture.sh"'),
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

try {
	await checkPayloadReplay();
	await checkCliDiscovery();
	console.log(`Codex hook conformance passed (${expectedCodexVersion}; CLI-only, no model).`);
} finally {
	for (const directory of temporaryDirectories.reverse()) {
		rmSync(directory, { recursive: true, force: true });
	}
}
