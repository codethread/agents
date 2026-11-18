import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerSelfTerminate } from "./index.js";
import type { RexPlan } from "./rex.js";

const window = { sessionId: "session:own", blockId: "block:own", windowId: "window:own" };

function setup(plan: RexPlan, debug = false) {
	let tool: any;
	const services = {
		inspectRexWindow: vi.fn(async () => plan),
		scheduleRexClose: vi.fn(async () => "/tmp/cleanup.log"),
	};
	const registerFlag = vi.fn();
	registerSelfTerminate(
		{
			registerTool(definition: any) {
				tool = definition;
			},
			registerFlag,
			getFlag: () => debug,
		} as unknown as ExtensionAPI,
		services,
	);
	const shutdown = vi.fn();
	const execute = (signal?: AbortSignal) =>
		tool.execute("call", {}, signal, undefined, { shutdown });
	return { tool, services, registerFlag, shutdown, execute };
}

describe("self-terminate", () => {
	it("keeps direct authorization explicit in a compact tool declaration", () => {
		const { tool, registerFlag } = setup({ kind: "close", window });
		expect(tool.name).toBe("self-terminate");
		expect(tool.description).toMatch(/directly authorized by the user; never infer permission/);
		expect(tool.description.length).toBeLessThan(160);
		expect(tool.promptSnippet).toBeUndefined();
		expect(tool.executionMode).toBe("sequential");
		expect(tool.parameters.properties).toEqual({});
		expect(registerFlag).toHaveBeenCalledWith("debug-self-terminate", expect.any(Object));
	});

	it("arms detached cleanup before requesting graceful shutdown and ends the turn", async () => {
		const { execute, services, shutdown } = setup({ kind: "close", window });
		services.scheduleRexClose.mockImplementation(async () => {
			expect(shutdown).not.toHaveBeenCalled();
			return "/tmp/cleanup.log";
		});
		const result = await execute();
		expect(services.scheduleRexClose).toHaveBeenCalledWith(window);
		expect(shutdown).toHaveBeenCalledOnce();
		expect(result).toMatchObject({ terminate: true, details: { logPath: "/tmp/cleanup.log" } });
	});

	it("still shuts down when Rex cleanup is unavailable and reports why", async () => {
		const { execute, services, shutdown } = setup({ kind: "skip", reason: "not in Rex" });
		const result = await execute();
		expect(services.scheduleRexClose).not.toHaveBeenCalled();
		expect(shutdown).toHaveBeenCalledOnce();
		expect(result.content[0].text).toContain("not in Rex");
	});

	it("fails without requesting shutdown if the helper cannot be armed", async () => {
		const { execute, services, shutdown } = setup({ kind: "close", window });
		services.scheduleRexClose.mockRejectedValue(new Error("spawn failed"));
		await expect(execute()).rejects.toThrow("spawn failed");
		expect(shutdown).not.toHaveBeenCalled();
	});

	it("dry-runs detection without scheduling closure or requesting shutdown", async () => {
		const { execute, services, shutdown } = setup({ kind: "close", window }, true);
		const result = await execute();
		expect(result.content[0].text).toContain("Dry run:");
		expect(services.scheduleRexClose).not.toHaveBeenCalled();
		expect(shutdown).not.toHaveBeenCalled();
		expect(result.terminate).toBeUndefined();
	});

	it("honors cancellation before arming cleanup", async () => {
		const { execute, services, shutdown } = setup({ kind: "close", window });
		await expect(execute(AbortSignal.abort())).rejects.toThrow();
		expect(services.scheduleRexClose).not.toHaveBeenCalled();
		expect(shutdown).not.toHaveBeenCalled();
	});
});
