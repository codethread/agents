import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPiDiscoveryExtension, type PiDiscoveryContextNoteDeps } from "./context-note.js";

interface TestContext {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
	};
	isIdle: () => boolean;
}

type InputHandler = (
	event: { text: string; source: string },
	ctx: TestContext,
) => Promise<{ action: "continue" } | { action: "transform"; text: string }>;
type EventHandler = (event: unknown, ctx: TestContext) => unknown | Promise<unknown>;
type SessionStartHandler = (event: unknown, ctx: TestContext) => unknown | Promise<unknown>;
type CommandHandler = (args: string, ctx: TestContext) => unknown | Promise<unknown>;
type RegisteredCommand = { description: string; handler: CommandHandler };

function makeContext(overrides: Partial<TestContext> = {}): TestContext {
	const notify = vi.fn();
	return {
		cwd: "/repo",
		hasUI: true,
		ui: { notify },
		isIdle: () => true,
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

function setupExtension(deps: PiDiscoveryContextNoteDeps) {
	const handlers = new Map<string, EventHandler>();
	const commands = new Map<string, RegisteredCommand>();
	const sendUserMessage = vi.fn();

	registerPiDiscoveryExtension(
		{
			on(eventName: string, handler: EventHandler) {
				handlers.set(eventName, handler);
			},
			registerCommand(name: string, command: RegisteredCommand) {
				commands.set(name, command);
			},
			sendUserMessage,
		} as any,
		deps,
	);

	return {
		inputHandler: handlers.get("input") as InputHandler,
		sessionStartHandler: handlers.get("session_start") as SessionStartHandler,
		debugExtensionsCommand: commands.get("debug-extensions"),
		sendUserMessage,
	};
}

describe("registerPiDiscoveryExtension", () => {
	let deps: PiDiscoveryContextNoteDeps;

	beforeEach(() => {
		deps = createDeps();
	});

	it("appends a context note to the first user message that mentions Pi", async () => {
		const discovery = makeDiscovery();
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(discovery);
		const { inputHandler } = setupExtension(deps);
		const ctx = makeContext();

		const result = await inputHandler(
			{ text: "How does Pi handle extensions?", source: "interactive" },
			ctx,
		);

		expect(result).toEqual({
			action: "transform",
			text: "How does Pi handle extensions?\n\n<pi-extension-discovery />",
		});
		expect(deps.discoverPiExtensions).toHaveBeenCalledWith("/repo");
		expect(deps.formatExtensionDiscoveryContextNote).toHaveBeenCalledWith(discovery);
	});

	it("fires only once per extension runtime instance", async () => {
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(makeDiscovery());
		const { inputHandler } = setupExtension(deps);
		const ctx = makeContext();

		await inputHandler({ text: "Tell me about Pi", source: "interactive" }, ctx);
		const second = await inputHandler({ text: "Pi again", source: "interactive" }, ctx);

		expect(second).toEqual({ action: "continue" });
		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(1);
	});

	it("ignores extension-originated input and lowercase pi", async () => {
		const { inputHandler } = setupExtension(deps);
		const ctx = makeContext();

		const fromExtension = await inputHandler(
			{ text: "Tell me about Pi", source: "extension" },
			ctx,
		);
		const lowercase = await inputHandler({ text: "tell me about pi", source: "interactive" }, ctx);

		expect(fromExtension).toEqual({ action: "continue" });
		expect(lowercase).toEqual({ action: "continue" });
		expect(deps.discoverPiExtensions).not.toHaveBeenCalled();
	});

	it("does not consume the one-shot trigger when discovery fails", async () => {
		vi.mocked(deps.discoverPiExtensions)
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(makeDiscovery());
		const { inputHandler } = setupExtension(deps);
		const ctx = makeContext();

		const first = await inputHandler({ text: "Explain Pi", source: "interactive" }, ctx);
		const second = await inputHandler(
			{ text: "Explain Pi extensions", source: "interactive" },
			ctx,
		);

		expect(first).toEqual({ action: "continue" });
		expect(second).toEqual({
			action: "transform",
			text: "Explain Pi extensions\n\n<pi-extension-discovery />",
		});
		expect(ctx.ui.notify).toHaveBeenCalledWith("[pi-discovery] boom", "warning");
		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(2);
	});

	it("warms discovery on session start and reuses the cached result", async () => {
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(makeDiscovery());
		const { inputHandler, sessionStartHandler } = setupExtension(deps);
		const ctx = makeContext();

		await sessionStartHandler({}, ctx);
		await inputHandler({ text: "Pi please", source: "interactive" }, ctx);

		expect(deps.discoverPiExtensions).toHaveBeenCalledTimes(1);
	});

	it("debug command shows the current discovery report in the UI only", async () => {
		const discovery = makeDiscovery();
		vi.mocked(deps.discoverPiExtensions).mockResolvedValue(discovery);
		const { debugExtensionsCommand, sendUserMessage } = setupExtension(deps);
		const ctx = makeContext({ isIdle: () => true });

		await debugExtensionsCommand?.handler("", ctx);

		expect(deps.formatExtensionDiscoveryReport).toHaveBeenCalledWith(discovery);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Extensions: ...", "info");
		expect(sendUserMessage).not.toHaveBeenCalled();
	});
});
