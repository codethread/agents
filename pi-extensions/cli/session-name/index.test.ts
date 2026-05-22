import { describe, expect, it, vi } from "vitest";
import sessionNameExtension, { DEBUG_SESSION_NAME_FLAG, SESSION_NAME_FLAG } from "./index.js";

function createPi(getFlag: (name: string) => unknown) {
	const handlers = new Map<string, (event: unknown, ctx: any) => void>();
	return {
		registerFlag: vi.fn(),
		on: vi.fn((event: string, handler: (event: unknown, ctx: any) => void) => {
			handlers.set(event, handler);
		}),
		getFlag: vi.fn(getFlag),
		setSessionName: vi.fn(),
		handlers,
	};
}

describe("sessionNameExtension", () => {
	it("registers name and debug flags", () => {
		const pi = createPi(() => undefined);

		sessionNameExtension(pi as any);

		expect(pi.registerFlag).toHaveBeenCalledWith(
			SESSION_NAME_FLAG,
			expect.objectContaining({ type: "string" }),
		);
		expect(pi.registerFlag).toHaveBeenCalledWith(
			DEBUG_SESSION_NAME_FLAG,
			expect.objectContaining({ type: "boolean", default: false }),
		);
	});

	it("sets a trimmed CLI session name on session_start", () => {
		const pi = createPi((name) => (name === SESSION_NAME_FLAG ? "  refactor auth  " : false));
		sessionNameExtension(pi as any);

		pi.handlers.get("session_start")?.({}, { hasUI: false, ui: { notify: vi.fn() } });

		expect(pi.setSessionName).toHaveBeenCalledWith("refactor auth");
	});

	it("ignores blank names", () => {
		const pi = createPi((name) => (name === SESSION_NAME_FLAG ? "   " : false));
		sessionNameExtension(pi as any);

		pi.handlers.get("session_start")?.({}, { hasUI: false, ui: { notify: vi.fn() } });

		expect(pi.setSessionName).not.toHaveBeenCalled();
	});
});
