import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiDiscoveryInputResult } from "./index.js";

const mocks = vi.hoisted(() => {
	const controller = {
		prime: vi.fn(),
		transformInput: vi.fn<() => Promise<PiDiscoveryInputResult>>(async () => ({
			action: "continue",
		})),
		getDebugReport: vi.fn(async () => "Extensions: ..."),
	};

	return {
		controller,
		createPiDiscoveryController: vi.fn(() => controller),
	};
});

vi.mock("./context-note.js", () => ({
	createPiDiscoveryController: mocks.createPiDiscoveryController,
}));

import piDiscoveryExtension from "./index.js";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.controller.transformInput.mockResolvedValue({ action: "continue" });
	mocks.controller.getDebugReport.mockResolvedValue("Extensions: ...");
});

describe("pi-discovery extension", () => {
	it("registers session/input handlers and debug command", () => {
		const on = vi.fn();
		const registerCommand = vi.fn();

		piDiscoveryExtension({
			on,
			registerCommand,
		} as any);

		expect(mocks.createPiDiscoveryController).toHaveBeenCalledTimes(1);
		expect(registerCommand).toHaveBeenCalledWith(
			"debug-extensions",
			expect.objectContaining({ description: expect.any(String), handler: expect.any(Function) }),
		);

		const counts = new Map<string, number>();
		for (const [eventName] of on.mock.calls) {
			counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
		}

		expect(counts.get("session_start")).toBe(1);
		expect(counts.get("input")).toBe(1);
	});

	it("warms discovery on session start", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();

		piDiscoveryExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerCommand: vi.fn(),
		} as any);

		await handlers.get("session_start")?.({}, { cwd: "/repo" });

		expect(mocks.controller.prime).toHaveBeenCalledWith("/repo");
	});

	it("delegates input transforms to the controller", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		mocks.controller.transformInput.mockResolvedValue({
			action: "transform",
			text: "Pi\n\n<context />",
		});

		piDiscoveryExtension({
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerCommand: vi.fn(),
		} as any);

		const result = await handlers.get("input")?.(
			{ text: "Pi", source: "interactive" },
			{ cwd: "/repo" },
		);

		expect(mocks.controller.transformInput).toHaveBeenCalledWith(
			{ text: "Pi", source: "interactive" },
			{ cwd: "/repo" },
		);
		expect(result).toEqual({ action: "transform", text: "Pi\n\n<context />" });
	});
});
