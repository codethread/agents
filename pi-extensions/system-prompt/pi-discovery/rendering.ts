import path from "node:path";
import { formatXmlElement, formatXmlTextElement } from "../../shared/xml.js";
import type { PiExtensionDiscovery, PiExtensionRecord, PiSourceDiscovery } from "./discovery.js";

const PI_CONTEXT_NOTE =
	"User mentioned Pi. Inspect these Pi/runtime/extension paths directly if relevant.";
const PI_DEBUG_NOTE = "Debug view. Hidden from agent.";

interface RenderOptions {
	note: string;
	pretty: boolean;
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

function formatExtensionSource(extension: PiExtensionRecord): string | undefined {
	return extension.source === extension.baseDir ? undefined : extension.source;
}

function formatExtensionDiscovery(discovery: PiExtensionDiscovery, options: RenderOptions): string {
	const indent = options.pretty ? "  " : "";
	const extensionIndent = options.pretty ? "    " : "";
	const separator = options.pretty ? "\n" : "";
	const parts = [
		formatXmlElement("pi-extension-discovery", { note: options.note }, { selfClosing: false }),
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
			{ indent },
		),
		formatXmlTextElement("pi-source", buildPiSourceText(discovery.piSource), {
			indent,
			multiline: true,
		}),
		`${indent}<available-extensions>`,
	];

	if (discovery.extensions.length === 0) {
		parts.push(`${extensionIndent}<none />`);
	} else {
		for (const extension of discovery.extensions) {
			parts.push(
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
					{ indent: extensionIndent },
				),
			);
		}
	}

	parts.push(`${indent}</available-extensions>`);
	parts.push("</pi-extension-discovery>");
	return parts.join(separator);
}

export function formatExtensionDiscoveryContextNote(discovery: PiExtensionDiscovery): string {
	return formatExtensionDiscovery(discovery, { note: PI_CONTEXT_NOTE, pretty: false });
}

export const formatExtensionDiscoveryForPrompt = formatExtensionDiscoveryContextNote;

export function formatExtensionDiscoveryReport(discovery: PiExtensionDiscovery): string {
	return formatExtensionDiscovery(discovery, { note: PI_DEBUG_NOTE, pretty: true });
}
