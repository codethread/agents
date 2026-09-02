import { access, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { modelsAreEqual } from "@earendil-works/pi-ai";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	hasTrustRequiringProjectResources,
	ProjectTrustStore,
	resolveCliModel,
	resolveModelScopeWithDiagnostics,
	SessionManager,
	SettingsManager,
	VERSION,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type AgentSessionRuntimeDiagnostic,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionRuntimeFactory,
	type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import { parsePiArgs, type ParsedPiArgs } from "./args.ts";
import {
	extensionExclusionsFromSettings,
	filterDaemonIncompatibleExtensions,
	parseExtensionExclusions,
} from "./extensions.ts";

type RunRequest = {
	args: string[];
	cwd: string;
	stdin?: string;
};

type ResultMetadata = {
	sessionId: string;
	sessionFile: string | undefined;
	model: string | undefined;
	thinkingLevel: ThinkingLevel;
	transcript: AgentSessionRuntime["session"]["state"]["messages"];
};

type RequestIo = {
	write(stream: "stdout" | "stderr", data: string): boolean;
	setAbort(handler: (() => void) | undefined): void;
	setResultMetadata(metadata: ResultMetadata): void;
	claimSession(sessionId: string): void;
	requestExit(code: number): void;
	exitRequested(): boolean;
	exitCode(): number;
};

type SessionOptions = Pick<
	CreateAgentSessionFromServicesOptions,
	"model" | "thinkingLevel" | "scopedModels" | "noTools" | "tools" | "excludeTools"
>;
type Diagnostic = AgentSessionRuntimeDiagnostic;

const IMAGE_MIME_TYPES = new Map([
	[".gif", "image/gif"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
]);

const HELP = `pies - concurrent headless Pi agents in one persistent process

Usage:
  pies [pi print-mode options] [--] [@files...] [messages...]
  pies daemon start|status|stop

Pies options:
  --logfile                     Print the invocation JSONL path and exit
  --exclude-extension <match>   Exclude by path substring (repeatable)

Persistent exclusions can also be set in Pi's global or trusted project settings:
  { "pies": { "excludeExtensions": ["pi-nvim", "/ui/"] } }

Pi-compatible headless options:
  --model, -m <provider/model>   Select a model (optional :thinking suffix)
  --provider <name>             Select a provider
  --thinking <level>            off|minimal|low|medium|high|xhigh|max
  --api-key <key>               Per-request runtime API key
  --continue, -c                Continue the latest project session
  --session <path|id>           Open a session file or matching session id
  --session-id <id>             Open or create an exact project session id
  --fork <path|id>              Fork a session into this project
  --session-dir <dir>           Override session storage
  --no-session                  Use an in-memory session
  --name, -n <name>             Set the session display name
  --tools, -t <names>           Tool allowlist
  --exclude-tools, -xt <names>  Tool denylist
  --no-tools, -nt               Disable all tools
  --no-builtin-tools, -nbt      Disable Pi built-ins only
  --extension, -e <path>        Add an extension (repeatable)
  --no-extensions, -ne          Disable extension discovery
  --skill <path>                Add a skill path (repeatable)
  --prompt-template <path>      Add a prompt-template path (repeatable)
  --system-prompt <text>        Replace the system prompt
  --append-system-prompt <text> Append to the system prompt (repeatable)
  --mode text|json              Final text or Pi-compatible event stream
  --approve, -a                 Trust project resources for this invocation
  --no-approve, -na             Do not load project resources
  --list-models [search]        List SDK models
  --print, -p                   Accepted for Pi command compatibility; implied
  --debug-pies                  Print daemon status without starting an agent

All discovered non-UI extensions run in print mode. Pi's process-exit helper is
omitted because terminating one request must not terminate the shared daemon.
`;

function expandPath(value: string, cwd: string): string {
	let expanded = value;
	if (value === "~") expanded = homedir();
	else if (value.startsWith("~/")) expanded = resolve(homedir(), value.slice(2));
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function resolveCliPaths(cwd: string, values: string[] | undefined): string[] | undefined {
	return values?.map((value) =>
		value.startsWith("npm:") || value.startsWith("git:") ? value : expandPath(value, cwd),
	);
}

function projectTrusted(cwd: string, agentDir: string, override: boolean | undefined): boolean {
	if (override !== undefined) return override;
	if (!hasTrustRequiringProjectResources(cwd)) return true;
	const stored = new ProjectTrustStore(agentDir).get(cwd);
	if (stored !== null) return stored;
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	return settings.getDefaultProjectTrust() === "always";
}

async function resolveSessionReference(
	reference: string,
	cwd: string,
	sessionDir: string | undefined,
): Promise<string | undefined> {
	if (reference.includes("/") || reference.includes("\\") || reference.endsWith(".jsonl")) {
		return expandPath(reference, cwd);
	}
	const local = (await SessionManager.list(cwd, sessionDir)).find((session) =>
		session.id.startsWith(reference),
	);
	if (local) return local.path;
	const global = (await SessionManager.listAll(sessionDir)).find((session) =>
		session.id.startsWith(reference),
	);
	return global?.path;
}

async function createSessionManager(
	parsed: ParsedPiArgs,
	cwd: string,
	sessionDir: string | undefined,
): Promise<SessionManager> {
	if (parsed.resume)
		throw new Error("--resume needs an interactive selector; use --session <path|id>");
	if (parsed.fork && (parsed.session || parsed.continue || parsed.noSession)) {
		throw new Error("--fork cannot be combined with --session, --continue, or --no-session");
	}
	if (parsed.noSession) return SessionManager.inMemory(cwd);
	if (parsed.fork) {
		const path = await resolveSessionReference(parsed.fork, cwd, sessionDir);
		if (!path) throw new Error(`No session found matching '${parsed.fork}'`);
		return SessionManager.forkFrom(path, cwd, sessionDir);
	}
	if (parsed.session) {
		const path = await resolveSessionReference(parsed.session, cwd, sessionDir);
		if (!path) throw new Error(`No session found matching '${parsed.session}'`);
		return SessionManager.open(path, sessionDir);
	}
	if (parsed.continue) return SessionManager.continueRecent(cwd, sessionDir);
	if (parsed.sessionId) {
		const existing = (await SessionManager.list(cwd, sessionDir)).find(
			(session) => session.id === parsed.sessionId,
		);
		if (existing) return SessionManager.open(existing.path, sessionDir);
	}
	return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}

function settingsDiagnostics(settingsManager: SettingsManager): Diagnostic[] {
	return settingsManager.drainErrors().map(({ scope, error }) => ({
		type: "warning",
		message: `(${scope} settings) ${error.message}`,
	}));
}

function buildSessionOptions(
	parsed: ParsedPiArgs,
	scopedModels: ScopedModel[],
	hasExistingSession: boolean,
	modelRuntime: Parameters<typeof resolveCliModel>[0]["modelRuntime"],
	settingsManager: SettingsManager,
): { options: SessionOptions; diagnostics: Diagnostic[]; cliThinkingFromModel: boolean } {
	const options: SessionOptions = {};
	const diagnostics: Diagnostic[] = [];
	let cliThinkingFromModel = false;

	if (parsed.model) {
		const resolvedModel = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			cliThinking: parsed.thinking,
			modelRuntime,
		});
		if (resolvedModel.warning)
			diagnostics.push({ type: "warning", message: resolvedModel.warning });
		if (resolvedModel.error) diagnostics.push({ type: "error", message: resolvedModel.error });
		if (resolvedModel.model) {
			options.model = resolvedModel.model;
			if (!parsed.thinking && resolvedModel.thinkingLevel) {
				options.thinkingLevel = resolvedModel.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !hasExistingSession) {
		const defaultProvider = settingsManager.getDefaultProvider();
		const defaultModel = settingsManager.getDefaultModel();
		const saved =
			defaultProvider && defaultModel
				? modelRuntime.getModel(defaultProvider, defaultModel)
				: undefined;
		const scoped = saved
			? scopedModels.find((candidate) => modelsAreEqual(candidate.model, saved))
			: undefined;
		const selected = scoped ?? scopedModels[0];
		options.model = selected.model;
		if (!parsed.thinking && selected.thinkingLevel) options.thinkingLevel = selected.thinkingLevel;
	}

	if (parsed.thinking) options.thinkingLevel = parsed.thinking;
	if (scopedModels.length > 0) options.scopedModels = scopedModels;
	if (parsed.noTools) options.noTools = "all";
	else if (parsed.noBuiltinTools) options.noTools = "builtin";
	if (parsed.tools) options.tools = parsed.tools;
	if (parsed.excludeTools) options.excludeTools = parsed.excludeTools;
	return { options, diagnostics, cliThinkingFromModel };
}

async function prepareInitialInput(
	parsed: ParsedPiArgs,
	cwd: string,
	stdin: string | undefined,
): Promise<{
	initialMessage: string | undefined;
	initialImages: ImageContent[] | undefined;
	messages: string[];
}> {
	let fileText = "";
	const images: ImageContent[] = [];
	for (const fileArg of parsed.fileArgs) {
		const path = expandPath(fileArg, cwd);
		await access(path);
		if ((await stat(path)).size === 0) continue;
		const mimeType = IMAGE_MIME_TYPES.get(extname(path).toLowerCase());
		if (mimeType) {
			images.push({ type: "image", mimeType, data: (await readFile(path)).toString("base64") });
			fileText += `<file name="${path}"></file>\n`;
		} else {
			fileText += `<file name="${path}">\n${await readFile(path, "utf8")}\n</file>\n`;
		}
	}

	const messages = [...parsed.messages];
	const parts = [];
	if (stdin !== undefined && stdin.length > 0) parts.push(stdin);
	if (fileText) parts.push(fileText);
	if (messages.length > 0) parts.push(messages.shift());
	return {
		initialMessage: parts.length > 0 ? parts.join("") : undefined,
		initialImages: images.length > 0 ? images : undefined,
		messages,
	};
}

function toJsonEvent(event: AgentSessionEvent): unknown {
	if (event.type !== "message_update" || event.message.role !== "assistant") return event;
	const assistantEvent = event.assistantMessageEvent;
	if (assistantEvent.type === "toolcall_start") {
		const toolCall = assistantEvent.partial.content[assistantEvent.contentIndex];
		const { partial: _partial, ...normalized } = assistantEvent;
		return {
			type: "message_update",
			usage: event.message.usage,
			assistantMessageEvent: {
				...normalized,
				id: toolCall?.type === "toolCall" ? toolCall.id : undefined,
				toolName: toolCall?.type === "toolCall" ? toolCall.name : undefined,
			},
		};
	}
	if ("partial" in assistantEvent) {
		const { partial: _partial, ...normalized } = assistantEvent;
		return {
			type: "message_update",
			usage: event.message.usage,
			assistantMessageEvent: normalized,
		};
	}
	return {
		type: "message_update",
		usage: event.message.usage,
		assistantMessageEvent: assistantEvent,
	};
}

function writeDiagnostic(io: RequestIo, diagnostic: Diagnostic): void {
	const prefix =
		diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
	io.write("stderr", `${prefix}${diagnostic.message}\n`);
}

async function bindRuntime(
	runtime: AgentSessionRuntime,
	mode: "json" | "text",
	io: RequestIo,
): Promise<() => void> {
	let session = runtime.session;
	let unsubscribe: (() => void) | undefined;
	const rebind = async () => {
		session = runtime.session;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			abortHandler: () => void session.abort(),
			shutdownHandler: () => io.requestExit(0),
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: (options) => runtime.newSession(options),
				fork: async (entryId, options) => {
					const result = await runtime.fork(entryId, options);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, options);
					return { cancelled: result.cancelled };
				},
				switchSession: (path, options) => runtime.switchSession(path, options),
				reload: () => session.reload(),
			},
			onError: (error) =>
				io.write("stderr", `Extension error (${error.extensionPath}): ${error.error}\n`),
		});
		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (mode === "json") io.write("stdout", `${JSON.stringify(toJsonEvent(event))}\n`);
		});
		io.setAbort(() => void session.abort());
	};
	runtime.setRebindSession(rebind);
	await rebind();
	return () => unsubscribe?.();
}

export async function runPiRequest(request: RunRequest, io: RequestIo): Promise<number> {
	const parsed = parsePiArgs(request.args);
	for (const diagnostic of parsed.diagnostics) writeDiagnostic(io, diagnostic);
	if (parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")) return 1;
	if (parsed.version) {
		io.write("stdout", `pies 0.1.0 (Pi SDK ${VERSION})\n`);
		return 0;
	}
	if (parsed.help) {
		io.write("stdout", HELP);
		return 0;
	}
	if (parsed.mode === "rpc") {
		io.write(
			"stderr",
			"Error: --mode rpc is not supported; pies already uses its own daemon protocol\n",
		);
		return 1;
	}
	if (parsed.export) {
		io.write("stderr", "Error: --export is not implemented in the pies POC\n");
		return 1;
	}

	const invocationCwd = resolve(request.cwd);
	const agentDir = getAgentDir();
	const startupSettings = SettingsManager.create(invocationCwd, agentDir, {
		projectTrusted: projectTrusted(invocationCwd, agentDir, parsed.projectTrustOverride),
	});
	const sessionDir = parsed.sessionDir
		? expandPath(parsed.sessionDir, invocationCwd)
		: process.env.PI_SESSION_DIR || startupSettings.getSessionDir();
	const sessionManager = await createSessionManager(parsed, invocationCwd, sessionDir);
	io.claimSession(sessionManager.getSessionId());
	if (parsed.name !== undefined) {
		const name = parsed.name.trim();
		if (!name) throw new Error("--name requires a non-empty value");
		sessionManager.appendSessionInfo(name);
	}

	const resolvedPaths = {
		extensions: resolveCliPaths(invocationCwd, parsed.extensions),
		skills: resolveCliPaths(invocationCwd, parsed.skills),
		prompts: resolveCliPaths(invocationCwd, parsed.promptTemplates),
		themes: resolveCliPaths(invocationCwd, parsed.themes),
	};
	const excludedExtensionPatterns = [
		...parseExtensionExclusions(process.env.PIES_EXCLUDE_EXTENSIONS),
		...(parsed.excludeExtensions ?? []),
	];
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSession,
		sessionStartEvent,
	}) => {
		io.claimSession(runtimeSession.getSessionId());
		const settingsManager = SettingsManager.create(cwd, runtimeAgentDir, {
			projectTrusted: projectTrusted(cwd, runtimeAgentDir, parsed.projectTrustOverride),
		});
		const configuredExtensionPatterns = [
			...extensionExclusionsFromSettings(settingsManager.getGlobalSettings(), "global"),
			...extensionExclusionsFromSettings(settingsManager.getProjectSettings(), "project"),
			...excludedExtensionPatterns,
		];
		const services = await createAgentSessionServices({
			cwd,
			agentDir: runtimeAgentDir,
			settingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedPaths.extensions,
				additionalSkillPaths: resolvedPaths.skills,
				additionalPromptTemplatePaths: resolvedPaths.prompts,
				additionalThemePaths: resolvedPaths.themes,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
				extensionsOverride: (base) =>
					filterDaemonIncompatibleExtensions(base, configuredExtensionPatterns),
			},
		});
		const extensionErrors: Diagnostic[] = services.resourceLoader
			.getExtensions()
			.errors.map(({ path, error }) => ({
				type: "error",
				message: `Failed to load extension "${path}": ${error}`,
			}));
		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scope = modelPatterns?.length
			? await resolveModelScopeWithDiagnostics(modelPatterns, services.modelRuntime, {
					signal: AbortSignal.timeout(15_000),
				})
			: { scopedModels: [], diagnostics: [] };
		const built = buildSessionOptions(
			parsed,
			scope.scopedModels,
			runtimeSession.buildSessionContext().messages.length > 0,
			services.modelRuntime,
			settingsManager,
		);
		const diagnostics = [
			...services.diagnostics,
			...settingsDiagnostics(settingsManager),
			...extensionErrors,
			...scope.diagnostics,
			...built.diagnostics,
		];
		if (parsed.apiKey) {
			if (!built.options.model) {
				diagnostics.push({ type: "error", message: "--api-key requires --model or --models" });
			} else
				await services.modelRuntime.setRuntimeApiKey(built.options.model.provider, parsed.apiKey);
		}
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSession,
			sessionStartEvent,
			...built.options,
		});
		if (created.session.model && (parsed.thinking !== undefined || built.cliThinkingFromModel)) {
			created.session.setThinkingLevel(created.session.thinkingLevel);
		}
		return { ...created, services, diagnostics };
	};

	let runtime: AgentSessionRuntime | undefined;
	let unsubscribe: (() => void) | undefined;
	try {
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: sessionManager.getCwd(),
			agentDir,
			sessionManager,
		});
		for (const diagnostic of runtime.diagnostics) writeDiagnostic(io, diagnostic);
		if (runtime.diagnostics.some((diagnostic) => diagnostic.type === "error")) return 1;

		if (parsed.listModels !== undefined) {
			const search = typeof parsed.listModels === "string" ? parsed.listModels.toLowerCase() : "";
			const models = [...runtime.services.modelRuntime.getModels()]
				.filter((model) =>
					`${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(search),
				)
				.sort((left, right) =>
					`${left.provider}/${left.id}`.localeCompare(`${right.provider}/${right.id}`),
				);
			for (const model of models)
				io.write("stdout", `${model.provider}/${model.id}\t${model.name}\n`);
			return 0;
		}

		if (!runtime.session.model) {
			io.write(
				"stderr",
				"Error: No model available. Configure credentials or pass --model and --api-key.\n",
			);
			return 1;
		}
		const mode = parsed.mode === "json" ? "json" : "text";
		if (mode === "json") {
			const header = runtime.session.sessionManager.getHeader();
			if (header) io.write("stdout", `${JSON.stringify(header)}\n`);
		}
		unsubscribe = await bindRuntime(runtime, mode, io);
		if (io.exitRequested()) return io.exitCode();

		const input = await prepareInitialInput(parsed, invocationCwd, request.stdin);
		if (input.initialMessage) {
			await runtime.session.prompt(input.initialMessage, { images: input.initialImages });
		}
		for (const message of input.messages) await runtime.session.prompt(message);
		if (io.exitRequested()) return io.exitCode();

		if (mode === "text") {
			const messages = runtime.session.state.messages;
			const last = messages[messages.length - 1];
			if (last?.role === "assistant") {
				if (last.stopReason === "error" || last.stopReason === "aborted") {
					io.write("stderr", `${last.errorMessage || `Request ${last.stopReason}`}\n`);
					return 1;
				}
				for (const content of last.content) {
					if (content.type === "text") io.write("stdout", `${content.text}\n`);
				}
			}
		}
		return 0;
	} finally {
		unsubscribe?.();
		io.setAbort(undefined);
		if (runtime) {
			const model = runtime.session.model;
			io.setResultMetadata({
				sessionId: runtime.session.sessionManager.getSessionId(),
				sessionFile: runtime.session.sessionManager.getSessionFile(),
				model: model ? `${model.provider}/${model.id}` : undefined,
				thinkingLevel: runtime.session.thinkingLevel,
				transcript: runtime.session.state.messages,
			});
			await runtime.dispose();
		}
	}
}
