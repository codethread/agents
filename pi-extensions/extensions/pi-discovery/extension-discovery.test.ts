import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendContextNoteToText,
	discoverPiExtensions,
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport,
	getExtensionNameFromPath,
	hasStandalonePiTrigger,
} from "./extension-discovery.js";

const tempDirs: string[] = [];

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

afterEach(async () => {
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
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });

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
	it("formats context-note and debug output with path metadata", () => {
		const discovery = {
			agentDir: "/home/user/.pi/agent",
			globalSettingsPath: "/home/user/.pi/agent/settings.json",
			globalExtensionsDir: "/home/user/.pi/agent/extensions",
			projectConfigDir: "/repo/.pi",
			projectSettingsPath: "/repo/.pi/settings.json",
			projectExtensionsDir: "/repo/.pi/extensions",
			extensions: [
				{
					name: "dynamic-agents-md",
					path: "/pkg/pi-extensions/extensions/dynamic-agents-md/index.ts",
					scope: "user" as const,
					source: "npm:@codethread/agents",
					origin: "package" as const,
					baseDir: "/pkg",
				},
			],
		};

		const note = formatExtensionDiscoveryContextNote(discovery);
		expect(note).toContain("[Context note: the user explicitly mentioned Pi.");
		expect(note).toContain("<pi_extension_discovery>");
		expect(note).toContain('globalSettings="/home/user/.pi/agent/settings.json"');
		expect(note).toContain('projectExtensionsDir="/repo/.pi/extensions"');
		expect(note).toContain('name="dynamic-agents-md"');
		expect(note).toContain('source="npm:@codethread/agents"');

		const report = formatExtensionDiscoveryReport(discovery);
		expect(report).toContain("Agent dir: /home/user/.pi/agent");
		expect(report).toContain("Extensions:");
		expect(report).toContain("- dynamic-agents-md");
		expect(report).toContain("  origin: package");
	});

	it("omits source when a local package source normalizes to the same path as baseDir", () => {
		const discovery = {
			agentDir: "/home/user/.pi/agent",
			globalSettingsPath: "/home/user/.pi/agent/settings.json",
			globalExtensionsDir: "/home/user/.pi/agent/extensions",
			projectConfigDir: "/repo/.pi",
			projectSettingsPath: "/repo/.pi/settings.json",
			projectExtensionsDir: "/repo/.pi/extensions",
			extensions: [
				{
					name: "bash-compact",
					path: "/repo/pi-extensions/extensions/bash-compact/index.ts",
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
		expect(report).not.toContain("  source: /repo");
	});
});
