import { describe, expect, it, vi } from "vitest";
import {
	createNotifyExtension,
	latestAssistantResponse,
	responsePreview,
	SettledNotification,
} from "./index.js";

describe("SettledNotification", () => {
	it("sends the title and latest response once, then must be re-armed", async () => {
		const send = vi.fn(async () => {});
		const notification = new SettledNotification(send);

		notification.arm("agent-ready agents(main)");
		notification.captureResponse("Here is the reply from the agent.");
		await expect(notification.settle()).resolves.toBe("sent");
		await expect(notification.settle()).resolves.toBe("idle");
		expect(send).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledWith({
			title: "agent-ready agents(main)",
			message: "Here is the reply from the agent.",
		});

		notification.arm("agent-ready next task");
		await expect(notification.settle()).resolves.toBe("sent");
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("consumes the request when delivery fails", async () => {
		const notification = new SettledNotification(async () => {
			throw new Error("service unavailable");
		});

		notification.arm("agent-ready agents(main)");
		await expect(notification.settle()).rejects.toThrow("service unavailable");
		expect(notification.isArmed()).toBe(false);
		await expect(notification.settle()).resolves.toBe("idle");
	});
});

describe("response content", () => {
	it("extracts the final assistant text blocks", () => {
		expect(
			latestAssistantResponse([
				{ role: "assistant", content: [{ type: "text", text: "old" }] },
				{ role: "user", content: [{ type: "text", text: "steer" }], timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "hidden" },
						{ type: "text", text: "first" },
						{ type: "text", text: "second" },
					],
				},
			] as any),
		).toBe("first\nsecond");
	});

	it("limits the preview by Unicode characters", () => {
		expect(responsePreview(`  ${"🙂".repeat(501)}  `)).toBe(`${"🙂".repeat(500)}…`);
	});
});

function setupExtension(send: (content: { title: string; message: string }) => Promise<void>) {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const commands = new Map<string, (...args: any[]) => Promise<void>>();
	const notify = vi.fn();
	const exec = vi.fn(async (_command: string, args: string[]) => ({
		stdout: args.includes("--show-toplevel") ? "/work/agents\n" : "main\n",
		stderr: "",
		code: 0,
		killed: false,
	}));
	const sendUserMessage = vi.fn();

	createNotifyExtension(send)({
		exec,
		getFlag: vi.fn(() => false),
		on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
		registerCommand: (name: string, command: { handler: (...args: any[]) => Promise<void> }) =>
			commands.set(name, command.handler),
		registerFlag: vi.fn(),
		sendUserMessage,
	} as any);

	return {
		commands,
		exec,
		handlers,
		notify,
		sendUserMessage,
		ctx: { cwd: "/work/agents/src", hasUI: true, ui: { notify } },
	};
}

describe("notify extension", () => {
	it("builds the default project title and sends the response without model-visible input", async () => {
		const send = vi.fn(async () => {});
		const { commands, ctx, handlers, notify, sendUserMessage } = setupExtension(send);

		await commands.get("notify")?.("", ctx);
		expect(sendUserMessage).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith("Notification armed: agent-ready agents(main)", "info");

		await handlers.get("agent_end")?.({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "text", text: "Intermediate reply." }] }],
		});
		await handlers.get("agent_end")?.({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "text", text: "Finished it." }] }],
		});
		await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
		await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

		expect(send).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledWith({
			title: "agent-ready agents(main)",
			message: "Finished it.",
		});
	});

	it("uses command text as the complete title suffix", async () => {
		const send = vi.fn(async () => {});
		const { commands, ctx, exec, handlers } = setupExtension(send);

		await commands.get("notify")?.("  working on notifications  ", ctx);
		expect(exec).not.toHaveBeenCalled();
		await handlers.get("agent_end")?.({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "text", text: "Here is the reply." }] }],
		});
		await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);

		expect(send).toHaveBeenCalledWith({
			title: "agent-ready working on notifications",
			message: "Here is the reply.",
		});
	});

	it("reports delivery failures in the UI", async () => {
		const { commands, ctx, handlers, notify } = setupExtension(async () => {
			throw new Error("notification service is down");
		});

		await commands.get("notify")?.("release", ctx);
		await handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
		expect(notify).toHaveBeenCalledWith("/notify failed: notification service is down", "error");
	});
});
