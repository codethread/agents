import fs from "node:fs";
import path from "node:path";
import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type SourceInfo,
} from "@mariozechner/pi-coding-agent";

const CONFIG_DIR_NAME = ".pi";
const PI_TRIGGER_REGEX = /(^|[^\p{L}\p{N}_])Pi(?=$|[^\p{L}\p{N}_])/u;

export interface PiExtensionRecord extends SourceInfo {
	name: string;
}

export interface PiExtensionDiscovery {
	agentDir: string;
	globalSettingsPath: string;
	globalExtensionsDir: string;
	projectConfigDir: string;
	projectSettingsPath: string;
	projectExtensionsDir: string;
	extensions: PiExtensionRecord[];
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function formatXmlAttributes(attributes: Record<string, string | undefined>): string {
	return Object.entries(attributes)
		.filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].length > 0)
		.map(([key, value]) => `${key}="${escapeXml(value)}"`)
		.join(" ");
}

export function getExtensionNameFromPath(filePath: string): string {
	const baseName = path.basename(filePath);
	if (baseName === "index.ts" || baseName === "index.js") {
		return path.basename(path.dirname(filePath));
	}
	return baseName.replace(/\.(ts|js)$/i, "");
}

function pathStatus(filePath: string): "exists" | "missing" {
	return fs.existsSync(filePath) ? "exists" : "missing";
}

function expandHomePrefix(input: string): string {
	if (input === "~") return process.env.HOME ?? input;
	if (input.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) return input;
		return path.join(home, input.slice(2));
	}
	return input;
}

function isNonLocalPackageSource(source: string): boolean {
	return (
		source.startsWith("npm:") ||
		source.startsWith("git:") ||
		/^(https?|ssh|git):\/\//i.test(source) ||
		/^[^/\\]+@[^:]+:.+/.test(source) ||
		/^[a-z0-9.-]+\.[a-z]{2,}[/:].+/i.test(source)
	);
}

function normalizeDiscoverySource(source: string, resolveBaseDir: string): string {
	if (isNonLocalPackageSource(source)) return source;
	return path.resolve(resolveBaseDir, expandHomePrefix(source));
}

function formatExtensionSource(extension: PiExtensionRecord): string | undefined {
	return extension.source === extension.baseDir ? undefined : extension.source;
}

export function hasStandalonePiTrigger(text: string): boolean {
	return PI_TRIGGER_REGEX.test(text);
}

export function appendContextNoteToText(text: string, contextNote: string): string {
	return `${text}\n\n${contextNote}`;
}

export async function discoverPiExtensions(
	cwd: string,
	agentDir = getAgentDir(),
): Promise<PiExtensionDiscovery> {
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
	});
	const resolved = await packageManager.resolve(async () => "skip");

	const projectConfigDir = path.join(cwd, CONFIG_DIR_NAME);
	const extensions = resolved.extensions
		.filter((entry) => entry.enabled)
		.map((entry) => ({
			name: getExtensionNameFromPath(entry.path),
			path: entry.path,
			source:
				entry.metadata.origin === "package"
					? normalizeDiscoverySource(
							entry.metadata.source,
							entry.metadata.scope === "project" ? projectConfigDir : agentDir,
						)
					: entry.metadata.source,
			scope: entry.metadata.scope,
			origin: entry.metadata.origin,
			baseDir: entry.metadata.baseDir,
		}));

	return {
		agentDir,
		globalSettingsPath: path.join(agentDir, "settings.json"),
		globalExtensionsDir: path.join(agentDir, "extensions"),
		projectConfigDir,
		projectSettingsPath: path.join(projectConfigDir, "settings.json"),
		projectExtensionsDir: path.join(projectConfigDir, "extensions"),
		extensions,
	};
}

export function formatExtensionDiscoveryContextNote(discovery: PiExtensionDiscovery): string {
	const lines = [
		"[Context note: the user explicitly mentioned Pi. If the request is about Pi behavior, installed extensions, prompt variables, or package-provided runtime features, inspect the matching extension source files before answering.]",
		"",
		"<pi_extension_discovery>",
		`  <paths ${formatXmlAttributes({
			agentDir: discovery.agentDir,
			globalSettings: discovery.globalSettingsPath,
			globalSettingsStatus: pathStatus(discovery.globalSettingsPath),
			globalExtensionsDir: discovery.globalExtensionsDir,
			globalExtensionsStatus: pathStatus(discovery.globalExtensionsDir),
			projectConfigDir: discovery.projectConfigDir,
			projectSettings: discovery.projectSettingsPath,
			projectSettingsStatus: pathStatus(discovery.projectSettingsPath),
			projectExtensionsDir: discovery.projectExtensionsDir,
			projectExtensionsStatus: pathStatus(discovery.projectExtensionsDir),
		})} />`,
		"  <available_extensions>",
	];

	if (discovery.extensions.length === 0) {
		lines.push("    <none />");
	} else {
		for (const extension of discovery.extensions) {
			lines.push(
				`    <extension ${formatXmlAttributes({
					name: extension.name,
					path: extension.path,
					scope: extension.scope,
					source: formatExtensionSource(extension),
					origin: extension.origin,
					baseDir: extension.baseDir,
				})} />`,
			);
		}
	}

	lines.push("  </available_extensions>");
	lines.push("</pi_extension_discovery>");
	return lines.join("\n");
}

export const formatExtensionDiscoveryForPrompt = formatExtensionDiscoveryContextNote;

export function formatExtensionDiscoveryReport(discovery: PiExtensionDiscovery): string {
	const lines = [
		`Agent dir: ${discovery.agentDir}`,
		`Global settings: ${discovery.globalSettingsPath} [${pathStatus(discovery.globalSettingsPath)}]`,
		`Global extensions dir: ${discovery.globalExtensionsDir} [${pathStatus(discovery.globalExtensionsDir)}]`,
		`Project config dir: ${discovery.projectConfigDir} [${pathStatus(discovery.projectConfigDir)}]`,
		`Project settings: ${discovery.projectSettingsPath} [${pathStatus(discovery.projectSettingsPath)}]`,
		`Project extensions dir: ${discovery.projectExtensionsDir} [${pathStatus(discovery.projectExtensionsDir)}]`,
	];

	if (discovery.extensions.length === 0) {
		lines.push("Extensions: (none)");
		return lines.join("\n");
	}

	lines.push("Extensions:");
	for (const extension of discovery.extensions) {
		lines.push(`- ${extension.name}`);
		lines.push(`  file: ${extension.path}`);
		lines.push(`  scope: ${extension.scope}`);
		const formattedSource = formatExtensionSource(extension);
		if (formattedSource) lines.push(`  source: ${formattedSource}`);
		lines.push(`  origin: ${extension.origin}`);
		if (extension.baseDir) lines.push(`  baseDir: ${extension.baseDir}`);
	}
	return lines.join("\n");
}
