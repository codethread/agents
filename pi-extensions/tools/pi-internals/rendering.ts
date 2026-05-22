import path from "node:path";
import type { PiExtensionDiscovery, PiExtensionRecord, PiSourceDiscovery } from "./discovery.js";

function buildPiSourceLines(piSource: PiSourceDiscovery): string[] {
	return [
		"Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):",
		`- Main documentation: ${path.join(piSource.inspectPackageDir, "README.md")}`,
		`- Additional docs: ${piSource.docsDir}`,
		`- Examples: ${piSource.examplesDir} (extensions, custom tools, SDK)`,
		"- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)",
		"- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing",
		"- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)",
	];
}

function formatExtensionSource(extension: PiExtensionRecord): string | undefined {
	return extension.source === extension.baseDir ? undefined : extension.source;
}

interface ExtensionGroup {
	heading: string;
	root: string;
	extensions: PiExtensionRecord[];
}

function isGlobalNpmExtension(extension: PiExtensionRecord): boolean {
	return (
		extension.source?.startsWith("npm:") === true &&
		extension.baseDir?.includes("node_modules") === true
	);
}

function getExtensionRoot(extension: PiExtensionRecord): string {
	return extension.baseDir ?? path.dirname(extension.path);
}

function getExtensionGroupKey(extension: PiExtensionRecord): string {
	const root = getExtensionRoot(extension);
	if (isGlobalNpmExtension(extension)) return path.dirname(root);
	return root;
}

function getExtensionGroupHeading(extension: PiExtensionRecord, root: string): string {
	if (isGlobalNpmExtension(extension)) return `Global npm extensions: ${root}`;
	if (extension.origin === "package") return `Package extensions: ${root}`;
	return `${extension.scope} extensions: ${root}`;
}

function groupExtensions(extensions: PiExtensionRecord[]): ExtensionGroup[] {
	const groups = new Map<string, ExtensionGroup>();

	for (const extension of extensions) {
		const root = getExtensionGroupKey(extension);
		const existing = groups.get(root);
		if (existing) {
			existing.extensions.push(extension);
			continue;
		}

		groups.set(root, {
			heading: getExtensionGroupHeading(extension, root),
			root,
			extensions: [extension],
		});
	}

	return [...groups.values()];
}

function formatExtension(extension: PiExtensionRecord, root: string): string {
	const source = formatExtensionSource(extension);
	const label = source ?? extension.name;
	const relativePath = `./${path.relative(root, extension.path)}`;
	return `  - ${label}: ${relativePath}`;
}

function formatExtensionGroups(extensions: PiExtensionRecord[]): string[] {
	if (extensions.length === 0) return ["- none"];

	return groupExtensions(extensions).flatMap((group) => [
		group.heading,
		...group.extensions.map((extension) => formatExtension(extension, group.root)),
	]);
}

function formatExtensionDiscovery(discovery: PiExtensionDiscovery): string {
	return [
		"Pi internals",
		"",
		"Use this report to inspect Pi/runtime/extension paths directly when relevant.",
		"",
		"Pi paths:",
		`- Agent dir: ${discovery.agentDir}`,
		`- Global settings: ${discovery.globalSettingsPath}`,
		`- Global extensions dir: ${discovery.globalExtensionsDir}`,
		`- Project config dir: ${discovery.projectConfigDir}`,
		`- Project settings: ${discovery.projectSettingsPath}`,
		`- Project extensions dir: ${discovery.projectExtensionsDir}`,
		"",
		...buildPiSourceLines(discovery.piSource),
		"",
		"Enabled extensions:",
		...formatExtensionGroups(discovery.extensions),
	].join("\n");
}

export function formatExtensionDiscoveryContextNote(discovery: PiExtensionDiscovery): string {
	return formatExtensionDiscovery(discovery);
}

export const formatExtensionDiscoveryForPrompt = formatExtensionDiscoveryContextNote;

export function formatExtensionDiscoveryReport(discovery: PiExtensionDiscovery): string {
	return formatExtensionDiscovery(discovery);
}
