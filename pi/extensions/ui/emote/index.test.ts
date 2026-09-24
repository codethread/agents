import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const constructed = vi.fn();
	const disposed = vi.fn(() => {
		process.stdout.write("\x1b_Ga=d,d=I,i=123,q=2\x1b\\");
	});

	class GraphicalRenderer {
		constructor(_size: number) {
			constructed();
		}
		setTui() {}
		loadFrames() {}
		getRenderedFrame() {
			return null;
		}
		setSize() {}
		showFrame() {
			return false;
		}
		showRandomFrame() {
			return false;
		}
		showTalkFrame() {
			return false;
		}
		showTalkCloseFrame() {
			return false;
		}
		showCycleFrame() {
			return false;
		}
		getCycleFrameCount() {
			return 0;
		}
		dispose() {
			disposed();
		}
		resetCache() {}
	}

	return { constructed, disposed, GraphicalRenderer };
});

vi.mock("./render_kitty.js", () => ({ KittyRenderer: mocks.GraphicalRenderer }));
vi.mock("./render_tmux_kitty.js", () => ({ TmuxKittyRenderer: mocks.GraphicalRenderer }));
vi.mock("./render_tmux_kitty_unicode.js", () => ({
	TmuxKittyUnicodeRenderer: mocks.GraphicalRenderer,
}));
vi.mock("./terminal.js", () => ({
	resolveRenderer: () => ({
		protocol: "kitty",
		multiplexer: null,
		warning: null,
		warningLevel: "info",
	}),
}));
vi.mock("./emotes.js", () => ({
	findEmoteSetDir: () => "/tmp/emotes/default",
	loadEmotesConfig: () => ({}),
	resolveEmoteSet: () => "default",
}));
vi.mock("./widget.js", () => ({ createWidgetFactory: () => () => undefined }));

import emoteExtension from "./index.js";

type Handler = (event: unknown, ctx: any) => Promise<void> | void;
type CommandHandler = (args: string, ctx: any) => Promise<void> | void;

function createExtensionApi() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, CommandHandler>();
	const api = {
		events: { on: vi.fn() },
		getFlag: vi.fn(() => undefined),
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
		registerCommand: vi.fn((name: string, command: { handler: CommandHandler }) =>
			commands.set(name, command.handler),
		),
		registerFlag: vi.fn(),
	};
	emoteExtension(api as any);
	return { commands, handlers };
}

function createContext(hasUI: boolean) {
	return {
		cwd: process.cwd(),
		hasUI,
		model: { id: "test-model" },
		ui: {
			notify: vi.fn(),
			setFooter: vi.fn(),
			setWidget: vi.fn(),
		},
	};
}

describe("emote renderer lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("keeps headless startup and shutdown stdout pure", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const { handlers } = createExtensionApi();
		const context = createContext(false);

		await handlers.get("session_start")?.({}, context);
		await handlers.get("session_shutdown")?.({}, context);

		expect(mocks.constructed).not.toHaveBeenCalled();
		expect(mocks.disposed).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
		stdout.mockRestore();
	});

	it("disposes the graphical renderer after it is enabled in an interactive session", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const { commands, handlers } = createExtensionApi();
		const context = createContext(true);

		await handlers.get("session_start")?.({}, context);
		await commands.get("emote")?.("on", context);
		await handlers.get("session_shutdown")?.({}, context);

		expect(mocks.constructed).toHaveBeenCalled();
		expect(mocks.disposed).toHaveBeenCalledOnce();
		expect(stdout).toHaveBeenCalledWith("\x1b_Ga=d,d=I,i=123,q=2\x1b\\");
		stdout.mockRestore();
	});
});
