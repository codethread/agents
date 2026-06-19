import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import projectRulesMessagingExtension from "./index.js";

function makeRoot() {
	return path.join(os.tmpdir(), `project-rules-message-${randomUUID()}`);
}

function write(root: string, filePath: string, content: string) {
	const fullPath = path.join(root, filePath);
	mkdirSync(path.dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content);
	return fullPath;
}

function createExecMock(root: string) {
	return vi.fn(async (command: string) => {
		if (command === "git") return { code: 0, stdout: `${root}\n`, stderr: "" };
		throw new Error(`Unexpected command: ${command}`);
	});
}

function createCtx(root: string) {
	return {
		cwd: root,
		hasUI: false,
		ui: { notify: vi.fn() },
	};
}

describe("project-rules messaging extension", () => {
	it("steers read-triggered project rules instead of queuing them as follow-ups", async () => {
		const root = makeRoot();
		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# TypeScript rules

- Keep changes type-safe.
`,
		);

		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const sendMessage = vi.fn();

		projectRulesMessagingExtension({
			exec: createExecMock(root),
			sendMessage,
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerMessageRenderer: vi.fn(),
		} as any);

		const ctx = createCtx(root);
		await handlers.get("session_start")?.({}, ctx);
		await handlers.get("tool_result")?.(
			{ toolName: "read", input: { path: "src/app.ts" }, isError: false },
			ctx,
		);

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "project-rules",
				content: expect.stringContaining('<system-reminder type="project-rules">'),
				display: true,
			}),
			{ deliverAs: "steer" },
		);
	});
});
