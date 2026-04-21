import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendContextNoteToText,
	discoverPiExtensions,
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
	getExtensionNameFromPath,
	hasStandalonePiTrigger,
} from "./extension-discovery.js";

const tempDirs: string[] = [];
const originalPiPackageDir = process.env.PI_PACKAGE_DIR;

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-discovery-"));
	tempDirs.push(dir);
	return dir;
}

function writeJson(filePath: string, value: unknown) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath: string, value: string) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, value);
}

function makeStaticDiscovery() {
	return {
		agentDir: "/home/user/.pi/agent",
		globalSettingsPath: "/home/user/.pi/agent/settings.json",
		globalExtensionsDir: "/home/user/.pi/agent/extensions",
		projectConfigDir: "/repo/.pi",
		projectSettingsPath: "/repo/.pi/settings.json",
		projectExtensionsDir: "/repo/.pi/extensions",
		piSource: {
			inspectPackageDir: "/pi-source",
			inspectPackageDirSource: "env" as const,
			runtimePackageDir: "/nix/store/pi",
			runtimePackageEntry: "/nix/store/pi/dist/index.js",
			docsDir: "/pi-source/docs",
			examplesDir: "/pi-source/examples",
			coreToolsDir: "/pi-source/dist/core/tools",
		},
		extensions: [
			{
				name: "dynamic-agents-md",
				path: "/pkg/pi-extensions/dynamic-agents-md/index.ts",
				scope: "user" as const,
				source: "npm:@codethread/agents",
				origin: "package" as const,
				baseDir: "/pkg",
			},
		],
	};
}

beforeEach(() => {
	process.env.PI_PACKAGE_DIR = originalPiPackageDir;
});

afterEach(async () => {
	process.env.PI_PACKAGE_DIR = originalPiPackageDir;
	const { rm } = await import("node:fs/promises");
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("getExtensionNameFromPath", () => {
	it("uses the parent directory for index files", () => {
		expect(getExtensionNameFromPath("/tmp/pi/extensions/dynamic-agents-md/index.ts")).toBe(
			"dynamic-agents-md",
		);
	});

	it("uses the file stem for single-file extensions", () => {
		expect(getExtensionNameFromPath("/tmp/pi/extensions/bash-compact.ts")).toBe("bash-compact");
	});
});

describe("hasStandalonePiTrigger", () => {
	it("matches a standalone, case-sensitive Pi token", () => {
		expect(hasStandalonePiTrigger("Tell me about Pi extensions")).toBe(true);
		expect(hasStandalonePiTrigger("What does Pi do?")).toBe(true);
		expect(hasStandalonePiTrigger("Pi's input hook")).toBe(true);
	});

	it("does not match lowercase or embedded substrings", () => {
		expect(hasStandalonePiTrigger("tell me about pi extensions")).toBe(false);
		expect(hasStandalonePiTrigger("pilot mode")).toBe(false);
		expect(hasStandalonePiTrigger("API docs")).toBe(false);
		expect(hasStandalonePiTrigger("Pi2 runtime")).toBe(false);
		expect(hasStandalonePiTrigger("Piñata mode")).toBe(false);
	});
});

describe("appendContextNoteToText", () => {
	it("appends the note after a blank line", () => {
		expect(appendContextNoteToText("Tell me about Pi", "[Context note]")).toBe(
			"Tell me about Pi\n\n[Context note]",
		);
	});
});

describe("discoverPiExtensions", () => {
	it("discovers enabled project, user, and package extension entrypoints in precedence order", async () => {
		const root = makeTempDir();
		const cwd = path.join(root, "workspace");
		const agentDir = path.join(root, "agent-home");
		const piSourceDir = path.join(root, "pi-source");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(path.join(piSourceDir, "docs"), { recursive: true });
		mkdirSync(path.join(piSourceDir, "examples"), { recursive: true });
		mkdirSync(path.join(piSourceDir, "dist", "core", "tools"), { recursive: true });
		process.env.PI_PACKAGE_DIR = piSourceDir;

		writeText(path.join(agentDir, "extensions", "user-auto.ts"), "export default function () {}\n");
		writeText(path.join(agentDir, "user-extra.ts"), "export default function () {}\n");
		writeJson(path.join(agentDir, "settings.json"), {
			extensions: ["./user-extra.ts"],
			packages: ["./packages/demo-pkg"],
		});

		writeJson(path.join(agentDir, "packages", "demo-pkg", "package.json"), {
			name: "demo-pkg",
			pi: {
				extensions: ["./extensions"],
			},
		});
		writeText(
			path.join(agentDir, "packages", "demo-pkg", "extensions", "from-package.ts"),
			"export default function () {}\n",
		);

		writeText(
			path.join(cwd, ".pi", "extensions", "project-auto.ts"),
			"export default function () {}\n",
		);
		writeText(path.join(cwd, ".pi", "project-extra.ts"), "export default function () {}\n");
		writeJson(path.join(cwd, ".pi", "settings.json"), {
			extensions: ["./project-extra.ts"],
		});

		const discovery = await discoverPiExtensions(cwd, agentDir);

		expect(discovery.extensions.map((extension) => extension.name)).toEqual([
			"project-extra",
			"project-auto",
			"user-extra",
			"user-auto",
			"from-package",
		]);

		expect(discovery.piSource).toMatchObject({
			inspectPackageDir: piSourceDir,
			inspectPackageDirSource: "env",
			docsDir: path.join(piSourceDir, "docs"),
			examplesDir: path.join(piSourceDir, "examples"),
			coreToolsDir: path.join(piSourceDir, "dist", "core", "tools"),
		});
		expect(discovery.piSource.runtimePackageEntry.length).toBeGreaterThan(0);
		expect(discovery.piSource.runtimePackageDir.length).toBeGreaterThan(0);

		const pkgExtension = discovery.extensions.at(-1);
		expect(pkgExtension).toMatchObject({
			name: "from-package",
			scope: "user",
			origin: "package",
			source: path.join(agentDir, "packages", "demo-pkg"),
			baseDir: path.join(agentDir, "packages", "demo-pkg"),
		});
	});
});

describe("formatters", () => {
	it("formats compact injected XML and multiline debug XML", () => {
		const discovery = makeStaticDiscovery();

		expect(formatExtensionDiscoveryContextNote(discovery)).toMatchInlineSnapshot(`
			"<pi_extension_discovery note="User mentioned Pi. Inspect these Pi/runtime/extension paths directly if relevant."><paths agentDir="/home/user/.pi/agent" globalSettings="/home/user/.pi/agent/settings.json" globalExtensionsDir="/home/user/.pi/agent/extensions" projectConfigDir="/repo/.pi" projectSettings="/repo/.pi/settings.json" projectExtensionsDir="/repo/.pi/extensions" /><pi_source>
			  Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
			  - Main documentation: /pi-source/README.md
			  - Additional docs: /pi-source/docs
			  - Examples: /pi-source/examples (extensions, custom tools, SDK)
			  - When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
			  - When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
			  - Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)
			</pi_source><available_extensions><extension name="dynamic-agents-md" path="/pkg/pi-extensions/dynamic-agents-md/index.ts" scope="user" source="npm:@codethread/agents" origin="package" baseDir="/pkg" /></available_extensions></pi_extension_discovery>"
		`);

		expect(formatExtensionDiscoveryReport(discovery)).toMatchInlineSnapshot(`
			"<pi_extension_discovery note="Debug view. Hidden from agent.">
			  <paths agentDir="/home/user/.pi/agent" globalSettings="/home/user/.pi/agent/settings.json" globalExtensionsDir="/home/user/.pi/agent/extensions" projectConfigDir="/repo/.pi" projectSettings="/repo/.pi/settings.json" projectExtensionsDir="/repo/.pi/extensions" />
			  <pi_source>
			    Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
			    - Main documentation: /pi-source/README.md
			    - Additional docs: /pi-source/docs
			    - Examples: /pi-source/examples (extensions, custom tools, SDK)
			    - When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
			    - When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
			    - Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)
			  </pi_source>
			  <available_extensions>
			    <extension name="dynamic-agents-md" path="/pkg/pi-extensions/dynamic-agents-md/index.ts" scope="user" source="npm:@codethread/agents" origin="package" baseDir="/pkg" />
			  </available_extensions>
			</pi_extension_discovery>"
		`);
	});

	it("omits source when a local package source normalizes to the same path as baseDir", () => {
		const discovery = {
			...makeStaticDiscovery(),
			extensions: [
				{
					name: "bash-compact",
					path: "/repo/pi-extensions/tools/bash/index.ts",
					scope: "project" as const,
					source: "/repo",
					origin: "package" as const,
					baseDir: "/repo",
				},
			],
		};

		const note = formatExtensionDiscoveryContextNote(discovery);
		expect(note).not.toContain('source="/repo"');

		const report = formatExtensionDiscoveryReport(discovery);
		expect(report).not.toContain('source="/repo"');
	});
});
