export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface PiArgDiagnostic {
	type: "error" | "warning";
	message: string;
}

export interface ParsedPiArgs {
	messages: string[];
	fileArgs: string[];
	unknownFlags: Map<string, string | true>;
	diagnostics: PiArgDiagnostic[];
	provider?: string;
	model?: string;
	apiKey?: string;
	systemPrompt?: string;
	name?: string;
	session?: string;
	sessionId?: string;
	fork?: string;
	sessionDir?: string;
	thinking?: ThinkingLevel;
	mode?: string;
	appendSystemPrompt?: string[];
	extensions?: string[];
	excludeExtensions?: string[];
	skills?: string[];
	promptTemplates?: string[];
	themes?: string[];
	models?: string[];
	tools?: string[];
	excludeTools?: string[];
	print?: true;
	continue?: true;
	resume?: true;
	noSession?: true;
	noTools?: true;
	noBuiltinTools?: true;
	noExtensions?: true;
	noSkills?: true;
	noPromptTemplates?: true;
	noThemes?: true;
	noContextFiles?: true;
	offline?: true;
	verbose?: true;
	projectTrustOverride?: boolean;
	help?: true;
	version?: true;
	listModels?: string | true;
	export?: string;
}

type ValueKey =
	| "provider"
	| "model"
	| "apiKey"
	| "systemPrompt"
	| "name"
	| "session"
	| "sessionId"
	| "fork"
	| "sessionDir"
	| "thinking"
	| "mode";
type RepeatableValueKey =
	| "appendSystemPrompt"
	| "extensions"
	| "excludeExtensions"
	| "skills"
	| "promptTemplates"
	| "themes";
type ListKey = "models" | "tools" | "excludeTools";

const THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

const VALUE_FLAGS = new Map<string, ValueKey>([
	["--provider", "provider"],
	["--model", "model"],
	["-m", "model"],
	["--api-key", "apiKey"],
	["--system-prompt", "systemPrompt"],
	["--name", "name"],
	["-n", "name"],
	["--session", "session"],
	["--session-id", "sessionId"],
	["--fork", "fork"],
	["--session-dir", "sessionDir"],
	["--thinking", "thinking"],
	["--mode", "mode"],
]);

const REPEATABLE_VALUE_FLAGS = new Map<string, RepeatableValueKey>([
	["--append-system-prompt", "appendSystemPrompt"],
	["--extension", "extensions"],
	["-e", "extensions"],
	["--exclude-extension", "excludeExtensions"],
	["--skill", "skills"],
	["--prompt-template", "promptTemplates"],
	["--theme", "themes"],
]);

const LIST_FLAGS = new Map<string, ListKey>([
	["--models", "models"],
	["--tools", "tools"],
	["-t", "tools"],
	["--exclude-tools", "excludeTools"],
	["-xt", "excludeTools"],
]);

function takeValue(
	args: string[],
	index: number,
	flag: string,
	diagnostics: PiArgDiagnostic[],
): { value: string | undefined; nextIndex: number } {
	const value = args[index + 1];
	if (value === undefined) {
		diagnostics.push({ type: "error", message: `${flag} requires a value` });
		return { value: undefined, nextIndex: index };
	}
	return { value, nextIndex: index + 1 };
}

function inlineValue(arg: string): { flag: string; value: string } | undefined {
	if (!arg.startsWith("--")) return undefined;
	const equals = arg.indexOf("=");
	if (equals === -1) return undefined;
	return { flag: arg.slice(0, equals), value: arg.slice(equals + 1) };
}

export function parsePiArgs(args: string[]): ParsedPiArgs {
	const result: ParsedPiArgs = {
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		diagnostics: [],
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			for (const positional of args.slice(index + 1)) {
				if (positional.startsWith("@")) result.fileArgs.push(positional.slice(1));
				else result.messages.push(positional);
			}
			break;
		}

		const inline = inlineValue(arg);
		const flag = inline?.flag ?? arg;
		const valueKey = VALUE_FLAGS.get(flag);
		if (valueKey) {
			const taken = inline
				? { value: inline.value, nextIndex: index }
				: takeValue(args, index, flag, result.diagnostics);
			index = taken.nextIndex;
			if (taken.value !== undefined) {
				if (valueKey === "thinking") result.thinking = taken.value as ThinkingLevel;
				else result[valueKey] = taken.value;
			}
			continue;
		}

		const repeatableKey = REPEATABLE_VALUE_FLAGS.get(flag);
		if (repeatableKey) {
			const taken = inline
				? { value: inline.value, nextIndex: index }
				: takeValue(args, index, flag, result.diagnostics);
			index = taken.nextIndex;
			if (taken.value !== undefined) {
				result[repeatableKey] ??= [];
				result[repeatableKey].push(taken.value);
			}
			continue;
		}

		const listKey = LIST_FLAGS.get(flag);
		if (listKey) {
			const taken = inline
				? { value: inline.value, nextIndex: index }
				: takeValue(args, index, flag, result.diagnostics);
			index = taken.nextIndex;
			if (taken.value !== undefined) {
				result[listKey] = taken.value
					.split(",")
					.map((value) => value.trim())
					.filter(Boolean);
			}
			continue;
		}

		if (arg === "--print" || arg === "-p") {
			result.print = true;
			const next = args[index + 1];
			if (
				next !== undefined &&
				!next.startsWith("@") &&
				(!next.startsWith("-") || next.startsWith("---"))
			) {
				result.messages.push(next);
				index += 1;
			}
		} else if (arg === "--continue" || arg === "-c") result.continue = true;
		else if (arg === "--resume" || arg === "-r") result.resume = true;
		else if (arg === "--no-session") result.noSession = true;
		else if (arg === "--no-tools" || arg === "-nt") result.noTools = true;
		else if (arg === "--no-builtin-tools" || arg === "-nbt") result.noBuiltinTools = true;
		else if (arg === "--no-extensions" || arg === "-ne") result.noExtensions = true;
		else if (arg === "--no-skills" || arg === "-ns") result.noSkills = true;
		else if (arg === "--no-prompt-templates" || arg === "-np") result.noPromptTemplates = true;
		else if (arg === "--no-themes") result.noThemes = true;
		else if (arg === "--no-context-files" || arg === "-nc") result.noContextFiles = true;
		else if (arg === "--offline") result.offline = true;
		else if (arg === "--verbose") result.verbose = true;
		else if (arg === "--approve" || arg === "-a") result.projectTrustOverride = true;
		else if (arg === "--no-approve" || arg === "-na") result.projectTrustOverride = false;
		else if (arg === "--help" || arg === "-h") result.help = true;
		else if (arg === "--version" || arg === "-v") result.version = true;
		else if (arg === "--list-models") {
			const next = args[index + 1];
			if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
				result.listModels = next;
				index += 1;
			} else result.listModels = true;
		} else if (arg === "--export") {
			const taken = takeValue(args, index, arg, result.diagnostics);
			index = taken.nextIndex;
			result.export = taken.value;
		} else if (arg.startsWith("@")) result.fileArgs.push(arg.slice(1));
		else if (arg.startsWith("--")) {
			const equals = arg.indexOf("=");
			if (equals !== -1) result.unknownFlags.set(arg.slice(2, equals), arg.slice(equals + 1));
			else {
				const name = arg.slice(2);
				const next = args[index + 1];
				if (next !== undefined && !next.startsWith("-") && !next.startsWith("@")) {
					result.unknownFlags.set(name, next);
					index += 1;
				} else result.unknownFlags.set(name, true);
			}
		} else if (arg.startsWith("-")) {
			result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
		} else result.messages.push(arg);
	}

	if (result.thinking && !THINKING_LEVELS.has(result.thinking)) {
		result.diagnostics.push({
			type: "warning",
			message: `Invalid thinking level "${result.thinking}". Valid values: ${[...THINKING_LEVELS].join(", ")}`,
		});
		delete result.thinking;
	}
	if (result.mode && !["text", "json", "rpc"].includes(result.mode)) {
		result.diagnostics.push({ type: "error", message: `Invalid output mode: ${result.mode}` });
	}
	if (result.excludeExtensions) {
		result.excludeExtensions = result.excludeExtensions.map((value) => value.trim());
		if (result.excludeExtensions.some((value) => value.length === 0)) {
			result.diagnostics.push({
				type: "error",
				message: "--exclude-extension requires a non-empty value",
			});
		}
		result.excludeExtensions = result.excludeExtensions.filter(Boolean);
	}
	return result;
}

export function argvForExtensions(args: string[]): string[] {
	const forwarded: string[] = [];
	let positional = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") positional = true;
		if (!positional && (arg === "--print" || arg === "-p")) continue;
		if (!positional && arg === "--exclude-extension") {
			index += 1;
			continue;
		}
		if (!positional && arg.startsWith("--exclude-extension=")) continue;
		forwarded.push(arg);
	}
	return [process.execPath, "pies", ...forwarded];
}
