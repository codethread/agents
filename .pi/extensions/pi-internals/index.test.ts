import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const discovery = {
		agentDir: "/agent",
		globalSettingsPath: "/agent/settings.json",
		globalExtensionsDir: "/agent/extensions",
		projectConfigDir: "/repo/.pi",
		projectSettingsPath: "/repo/.pi/settings.json",
		projectExtensionsDir: "/repo/.pi/extensions",
		piSource: {
			inspectPackageDir: "/pi-source",
			inspectPackageDirSource: "env",
			runtimePackageDir: "/runtime",
			runtimePackageEntry: "/runtime/index.js",
			docsDir: "/pi-source/docs",
			examplesDir: "/pi-source/examples",
			coreToolsDir: "/pi-source/dist/core/tools",
		},
		extensions: [
			{
				name: "pi-internals",
				path: "/repo/.pi/extensions/pi-internals/index.ts",
				scope: "project",
				origin: "top-level",
				baseDir: "/repo/.pi/extensions/pi-internals",
			},
		],
	};

	return {
		discovery,
		discoverPiExtensions: vi.fn(async () => discovery),
		formatExtensionDiscoveryContextNote: vi.fn(() => "Pi internals\n\n..."),
		formatExtensionDiscoveryReport: vi.fn(() => "Pi internals\n\n..."),
	};
});

vi.mock("./discovery.js", () => ({
	discoverPiExtensions: mocks.discoverPiExtensions,
}));

vi.mock("./rendering.js", () => ({
	formatExtensionDiscoveryContextNote: mocks.formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryReport: mocks.formatExtensionDiscoveryReport,
}));

import piInternalsExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.discoverPiExtensions.mockResolvedValue(mocks.discovery);
	mocks.formatExtensionDiscoveryContextNote.mockReturnValue("Pi internals\n\n...");
	mocks.formatExtensionDiscoveryReport.mockReturnValue("Pi internals\n\n...");
});

describe("pi-internals tool extension", () => {
	it("registers the pi-internals tool, debug command, flag, and session handler", () => {
		const on = vi.fn();
		const registerTool = vi.fn();
		const registerCommand = vi.fn();
		const registerFlag = vi.fn();

		piInternalsExtension({
			on,
			registerTool,
			registerCommand,
			registerFlag,
			getFlag: vi.fn(() => false),
		} as any);

		expect(registerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "pi-internals",
				label: "Pi Internals",
				execute: expect.any(Function),
			}),
		);
		expect(registerCommand).toHaveBeenCalledWith(
			"debug-pi-internals",
			expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
		);
		expect(registerFlag).toHaveBeenCalledWith(
			"debug-pi-internals",
			expect.objectContaining({ type: "boolean", default: false }),
		);
		expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
	});

	it("tool returns the full report to the agent and discovery details for UI rendering", async () => {
		let tool: any;

		piInternalsExtension({
			on: vi.fn(),
			registerTool(definition: any) {
				tool = definition;
			},
			registerCommand: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(() => false),
		} as any);

		const result = await tool.execute("call-1", {}, undefined, undefined, { cwd: "/repo" });

		expect(mocks.discoverPiExtensions).toHaveBeenCalledWith("/repo");
		expect(mocks.formatExtensionDiscoveryContextNote).toHaveBeenCalledWith(mocks.discovery);
		expect(result).toEqual({
			content: [{ type: "text", text: "Pi internals\n\n..." }],
			details: mocks.discovery,
		});
	});

	it("renders a terse UI summary while preserving full tool content", async () => {
		let tool: any;

		piInternalsExtension({
			on: vi.fn(),
			registerTool(definition: any) {
				tool = definition;
			},
			registerCommand: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(() => false),
		} as any);

		const component = tool.renderResult(
			{ content: [{ type: "text", text: "Pi internals\n\n..." }], details: mocks.discovery },
			{},
			{ fg: (_name: string, value: string) => value },
			{ isError: false },
		);

		const output = component
			.render(120)
			.map((line: string) => line.trimEnd())
			.join("\n");

		expect(output).toMatchInlineSnapshot(`
			"Pi source: /pi-source
			Project config: /repo/.pi
			Extensions: 1 enabled
			Extension roots: /repo/.pi/extensions/pi-internals"
		`);
	});

	it("debug command writes the report in print mode", async () => {
		let command: any;

		piInternalsExtension({
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand(_name: string, definition: any) {
				command = definition;
			},
			registerFlag: vi.fn(),
			getFlag: vi.fn(() => false),
		} as any);

		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		try {
			await command.handler("", { cwd: "/repo", hasUI: false });
			expect(write).toHaveBeenCalledWith("Pi internals\n\n...\n");
		} finally {
			write.mockRestore();
		}
	});
});
