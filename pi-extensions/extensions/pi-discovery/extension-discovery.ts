import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type SourceInfo,
} from "@mariozechner/pi-coding-agent";

const CONFIG_DIR_NAME = ".pi";
const PI_TRIGGER_REGEX = /(^|[^\p{L}\p{N}_])Pi(?=$|[^\p{L}\p{N}_])/u;
const PI_CONTEXT_NOTE =
	"User mentioned Pi. Inspect these Pi/runtime/extension paths directly if relevant.";
const PI_DEBUG_NOTE = "Debug view. Hidden from agent.";

export interface PiExtensionRecord extends SourceInfo {
	name: string;
}

export type PiInspectPackageDirSource = "env" | "runtime-package";

export interface PiSourceDiscovery {
	inspectPackageDir: string;
	inspectPackageDirSource: PiInspectPackageDirSource;
	runtimePackageDir: string;
	runtimePackageEntry: string;
	docsDir: string;
	examplesDir: string;
	coreToolsDir: string;
}

export interface PiExtensionDiscovery {
	agentDir: string;
	globalSettingsPath: string;
	globalExtensionsDir: string;
	projectConfigDir: string;
	projectSettingsPath: string;
	projectExtensionsDir: string;
	piSource: PiSourceDiscovery;
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

function formatXmlElement(
	tagName: string,
	attributes: Record<string, string | undefined>,
	options: { indent?: string; selfClosing?: boolean } = {},
): string {
	const indent = options.indent ?? "";
	const attrs = formatXmlAttributes(attributes);
	if (options.selfClosing ?? true) {
		return attrs.length > 0 ? `${indent}<${tagName} ${attrs} />` : `${indent}<${tagName} />`;
	}
	return attrs.length > 0 ? `${indent}<${tagName} ${attrs}>` : `${indent}<${tagName}>`;
}

function formatXmlTextElement(
	tagName: string,
	text: string,
	options: { indent?: string; multiline?: boolean } = {},
): string {
	const indent = options.indent ?? "";
	if (!options.multiline) return `${indent}<${tagName}>${escapeXml(text)}</${tagName}>`;
	const content = text
		.split("\n")
		.map((line) => `${indent}  ${escapeXml(line)}`)
		.join("\n");
	return `${indent}<${tagName}>\n${content}\n${indent}</${tagName}>`;
}

function buildPiSourceText(piSource: PiSourceDiscovery): string {
	const readmePath = path.join(piSource.inspectPackageDir, "README.md");
	const docsPath = piSource.docsDir;
	const examplesPath = piSource.examplesDir;
	return [
		"Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):",
		`- Main documentation: ${readmePath}`,
		`- Additional docs: ${docsPath}`,
		`- Examples: ${examplesPath} (extensions, custom tools, SDK)`,
		"- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)",
		"- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing",
		"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)",
	].join("\n");
}

export function getExtensionNameFromPath(filePath: string): string {
	const baseName = path.basename(filePath);
	if (baseName === "index.ts" || baseName === "index.js") {
		return path.basename(path.dirname(filePath));
	}
	return baseName.replace(/\.(ts|js)$/i, "");
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

function pathFromModuleSpecifier(specifier: string): string {
	return specifier.startsWith("file://") ? fileURLToPath(specifier) : specifier;
}

export function discoverPiSource(): PiSourceDiscovery {
	const runtimePackageEntry = pathFromModuleSpecifier(
		import.meta.resolve("@mariozechner/pi-coding-agent"),
	);
	const runtimePackageDir = path.resolve(path.dirname(runtimePackageEntry), "..");
	const inspectPackageDirFromEnv = process.env.PI_PACKAGE_DIR
		? path.resolve(expandHomePrefix(process.env.PI_PACKAGE_DIR))
		: null;
	const inspectPackageDir = inspectPackageDirFromEnv ?? runtimePackageDir;

	return {
		inspectPackageDir,
		inspectPackageDirSource: inspectPackageDirFromEnv ? "env" : "runtime-package",
		runtimePackageDir,
		runtimePackageEntry,
		docsDir: path.join(inspectPackageDir, "docs"),
		examplesDir: path.join(inspectPackageDir, "examples"),
		coreToolsDir: path.join(inspectPackageDir, "dist", "core", "tools"),
	};
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
		piSource: discoverPiSource(),
		extensions,
	};
}

export function formatExtensionDiscoveryContextNote(discovery: PiExtensionDiscovery): string {
	const parts = [
		formatXmlElement("pi_extension_discovery", { note: PI_CONTEXT_NOTE }, { selfClosing: false }),
		formatXmlElement("paths", {
			agentDir: discovery.agentDir,
			globalSettings: discovery.globalSettingsPath,
			globalExtensionsDir: discovery.globalExtensionsDir,
			projectConfigDir: discovery.projectConfigDir,
			projectSettings: discovery.projectSettingsPath,
			projectExtensionsDir: discovery.projectExtensionsDir,
		}),
		formatXmlTextElement("pi_source", buildPiSourceText(discovery.piSource), {
			multiline: true,
		}),
		"<available_extensions>",
	];

	if (discovery.extensions.length === 0) {
		parts.push("<none />");
	} else {
		for (const extension of discovery.extensions) {
			parts.push(
				formatXmlElement("extension", {
					name: extension.name,
					path: extension.path,
					scope: extension.scope,
					source: formatExtensionSource(extension),
					origin: extension.origin,
					baseDir: extension.baseDir,
				}),
			);
		}
	}

	parts.push("</available_extensions>");
	parts.push("</pi_extension_discovery>");
	return parts.join("");
}

export const formatExtensionDiscoveryForPrompt = formatExtensionDiscoveryContextNote;

export function formatExtensionDiscoveryReport(discovery: PiExtensionDiscovery): string {
	const lines = [
		formatXmlElement("pi_extension_discovery", { note: PI_DEBUG_NOTE }, { selfClosing: false }),
		formatXmlElement(
			"paths",
			{
				agentDir: discovery.agentDir,
				globalSettings: discovery.globalSettingsPath,
				globalExtensionsDir: discovery.globalExtensionsDir,
				projectConfigDir: discovery.projectConfigDir,
				projectSettings: discovery.projectSettingsPath,
				projectExtensionsDir: discovery.projectExtensionsDir,
			},
			{ indent: "  " },
		),
		formatXmlTextElement("pi_source", buildPiSourceText(discovery.piSource), {
			indent: "  ",
			multiline: true,
		}),
		"  <available_extensions>",
	];

	if (discovery.extensions.length === 0) {
		lines.push("    <none />");
	} else {
		for (const extension of discovery.extensions) {
			lines.push(
				formatXmlElement(
					"extension",
					{
						name: extension.name,
						path: extension.path,
						scope: extension.scope,
						source: formatExtensionSource(extension),
						origin: extension.origin,
						baseDir: extension.baseDir,
					},
					{ indent: "    " },
				),
			);
		}
	}

	lines.push("  </available_extensions>");
	lines.push("</pi_extension_discovery>");
	return lines.join("\n");
}
