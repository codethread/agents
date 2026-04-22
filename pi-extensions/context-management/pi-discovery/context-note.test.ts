import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPiDiscoveryController, type PiDiscoveryContextNoteDeps } from "./context-note.js";

interface TestContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
	};
}

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
	const notify = vi.fn();
	return {
		cwd: "/repo",
		hasUI: true,
		ui: { notify },
		...overrides,
	};
}

function makeDiscovery() {
	return {
		agentDir: "/agent",
		globalSettingsPath: "/agent/settings.json",
		globalExtensionsDir: "/agent/extensions",
		projectConfigDir: "/repo/.pi",
		projectSettingsPath: "/repo/.pi/settings.json",
		projectExtensionsDir: "/repo/.pi/extensions",
		piSource: {
			inspectPackageDir: "/pi-source",
			inspectPackageDirSource: "env" as const,
			runtimePackageDir: "/runtime/pi",
			runtimePackageEntry: "/runtime/pi/dist/index.js",
			docsDir: "/pi-source/docs",
			examplesDir: "/pi-source/examples",
			coreToolsDir: "/pi-source/dist/core/tools",
		},
		extensions: [],
	};
}

function createDeps(): PiDiscoveryContextNoteDeps {
	return {
		discoverPiExtensions: vi.fn(),
		formatExtensionDiscoveryContextNote: vi.fn().mockReturnValue("<pi-extension-discovery />"),
		formatExtensionDiscoveryReport: vi.fn().mockReturnValue("Extensions: ..."),
		hasStandalonePiTrigger: (text: string) =>
			/(^|[^\p{L}\p{N}_])Pi(?=$|[^\p{L}\p{N}_])/u.test(text),
		appendContextNoteToText: (text: string, note: string) => `${text}\n\n${note}`,
	};
}

describe("createPiDiscoveryController", () => {
	let deps: PiDiscoveryContextNoteDeps;

	beforeEach(() => {
		deps = createDeps();
	});

	it("appends a context note to the first user message that mentions Pi", async () => {
		const discovery = makeDiscovery();
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(discovery);
		const controller = createPiDiscoveryController(deps);
		const ctx = makeContext();

		const result = await controller.transformInput(
			{ text: "How does Pi handle extensions?", source: "interactive" },
			ctx as any,
		);

		expect(result).toEqual({
			action: "transform",
			text: "How does Pi handle extensions?\n\n<pi-extension-discovery />",
		});
		expect(deps.discoverPiExtensions).toHaveBeenCalledWith("/repo");
		expect(deps.formatExtensionDiscoveryContextNote).toHaveBeenCalledWith(discovery);
	});

	it("fires only once per controller instance", async () => {
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(makeDiscovery());
		const controller = createPiDiscoveryController(deps);
		const ctx = makeContext();

		await controller.transformInput(
			{ text: "Tell me about Pi", source: "interactive" },
			ctx as any,
		);
		const second = await controller.transformInput(
			{ text: "Pi again", source: "interactive" },
			ctx as any,
		);

		expect(second).toEqual({ action: "continue" });
		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(1);
	});

	it("ignores extension-originated input and lowercase pi", async () => {
		const controller = createPiDiscoveryController(deps);
		const ctx = makeContext();

		const fromExtension = await controller.transformInput(
			{ text: "Tell me about Pi", source: "extension" },
			ctx as any,
		);
		const lowercase = await controller.transformInput(
			{ text: "tell me about pi", source: "interactive" },
			ctx as any,
		);

		expect(fromExtension).toEqual({ action: "continue" });
		expect(lowercase).toEqual({ action: "continue" });
		expect(deps.discoverPiExtensions).not.toHaveBeenCalled();
	});

	it("does not consume the one-shot trigger when discovery fails", async () => {
		vi.mocked(deps.discoverPiExtensions)
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(makeDiscovery());
		const controller = createPiDiscoveryController(deps);
		const ctx = makeContext();

		const first = await controller.transformInput(
			{ text: "Explain Pi", source: "interactive" },
			ctx as any,
		);
		const second = await controller.transformInput(
			{ text: "Explain Pi extensions", source: "interactive" },
			ctx as any,
		);

		expect(first).toEqual({ action: "continue" });
		expect(second).toEqual({
			action: "transform",
			text: "Explain Pi extensions\n\n<pi-extension-discovery />",
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith("[pi-discovery] boom", "warning");
		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(2);
	});

	it("warms discovery and reuses the cached result", async () => {
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(makeDiscovery());
		const controller = createPiDiscoveryController(deps);
		const ctx = makeContext();

		controller.prime(ctx.cwd);
		await Promise.resolve();
		await controller.transformInput({ text: "Pi please", source: "interactive" }, ctx as any);

		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(1);
	});

	it("formats the debug report from the cached discovery", async () => {
		const discovery = makeDiscovery();
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(discovery);
		const controller = createPiDiscoveryController(deps);

		const result = await controller.getDebugReport("/repo");

		expect(result).toBe("Extensions: ...");
		expect(deps.formatExtensionDiscoveryReport).toHaveBeenCalledWith(discovery);
	});
});
