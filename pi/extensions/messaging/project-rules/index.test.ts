import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatProjectRulesNotice } from "./index.js";
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

function bumpMtime(filePath: string) {
	const mtime = statSync(filePath).mtime;
	utimesSync(filePath, mtime, new Date(mtime.getTime() + 1_000));
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

function setupExtension(root: string) {
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
	return { ctx, handlers, sendMessage };
}

async function startSession(handlers: Map<string, (event: any, ctx: any) => unknown>, ctx: any) {
	await handlers.get("session_start")?.({}, ctx);
}

async function beforeAgentStart(
	handlers: Map<string, (event: any, ctx: any) => unknown>,
	ctx: any,
	prompt: string,
) {
	return handlers.get("before_agent_start")?.({ prompt }, ctx);
}

async function readPath(
	handlers: Map<string, (event: any, ctx: any) => unknown>,
	ctx: any,
	filePath: string,
) {
	await handlers.get("tool_result")?.(
		{ toolName: "read", input: { path: filePath }, isError: false },
		ctx,
	);
}

describe("project-rules messaging extension", () => {
	it("formats a single visible notice inline and multiple notices as a list", () => {
		expect(formatProjectRulesNotice([".claude/rules/some-rule.md"])).toBe(
			"Project rules sent to agent (.claude/rules/some-rule.md)",
		);
		expect(
			formatProjectRulesNotice([".claude/rules/some-rule.md", ".agents/rules/some-other-rule.md"]),
		).toBe(
			[
				"Project rules sent to agent",
				"  - .claude/rules/some-rule.md",
				"  - .agents/rules/some-other-rule.md",
			].join("\n"),
		);
	});

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

		const { ctx, handlers, sendMessage } = setupExtension(root);
		await startSession(handlers, ctx);
		await readPath(handlers, ctx, "src/app.ts");

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "project-rules",
				content: expect.stringContaining('<system-reminder type="project-rules">'),
				display: true,
				details: {
					rulePaths: [".agents/rules/typescript.md"],
					triggeredBy: ["src/app.ts"],
				},
			}),
			{ deliverAs: "steer" },
		);
	});

	it("dedupes prompt-triggered scoped rules across different matching files in one session", async () => {
		const root = makeRoot();
		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# TypeScript rules
`,
		);

		const { ctx, handlers } = setupExtension(root);
		await startSession(handlers, ctx);

		const first = await beforeAgentStart(handlers, ctx, "Inspect @src/a.ts");
		expect(first).toEqual(
			expect.objectContaining({
				message: expect.objectContaining({
					details: {
						rulePaths: [".agents/rules/typescript.md"],
						triggeredBy: ["src/a.ts"],
					},
				}),
			}),
		);

		const second = await beforeAgentStart(handlers, ctx, "Inspect @src/b.ts");
		expect(second).toBeUndefined();
	});

	it("sends only unseen prompt-triggered rules when seen and unseen matches overlap", async () => {
		const root = makeRoot();
		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# TypeScript rules
`,
		);
		write(
			root,
			".agents/rules/app.md",
			`---
paths:
  - "src/app.ts"
---

# App rules
`,
		);

		const { ctx, handlers } = setupExtension(root);
		await startSession(handlers, ctx);
		await readPath(handlers, ctx, "src/other.ts");

		const result = await beforeAgentStart(handlers, ctx, "Inspect @src/app.ts");
		expect(result).toEqual(
			expect.objectContaining({
				message: expect.objectContaining({
					content: expect.stringContaining("# App rules"),
					details: {
						rulePaths: [".agents/rules/app.md"],
						triggeredBy: ["src/app.ts"],
					},
				}),
			}),
		);
		expect((result as any).message.content).not.toContain("# TypeScript rules");
	});

	it("resends a changed scoped rule version once on the next matching trigger", async () => {
		const root = makeRoot();
		const rulePath = write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# TypeScript rules v1
`,
		);

		const { ctx, handlers, sendMessage } = setupExtension(root);
		await startSession(handlers, ctx);
		await readPath(handlers, ctx, "src/a.ts");

		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# TypeScript rules v2
`,
		);
		bumpMtime(rulePath);

		await readPath(handlers, ctx, "src/b.ts");

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(sendMessage.mock.calls[0]?.[0].content).toContain("# TypeScript rules v1");
		expect(sendMessage.mock.calls[1]?.[0].content).toContain("# TypeScript rules v2");
	});

	it("treats a new override as a new scoped rule version", async () => {
		const root = makeRoot();
		write(
			root,
			".claude/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# Claude TypeScript rules
`,
		);

		const { ctx, handlers, sendMessage } = setupExtension(root);
		await startSession(handlers, ctx);
		await readPath(handlers, ctx, "src/a.ts");

		write(
			root,
			".agents/rules/typescript.md",
			`---
paths:
  - "src/**/*.ts"
---

# Agents TypeScript rules
`,
		);

		await readPath(handlers, ctx, "src/b.ts");

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(sendMessage.mock.calls[0]?.[0].details.rulePaths).toEqual([
			".claude/rules/typescript.md",
		]);
		expect(sendMessage.mock.calls[1]?.[0].details.rulePaths).toEqual([
			".agents/rules/typescript.md",
		]);
		expect(sendMessage.mock.calls[1]?.[0].content).toContain("# Agents TypeScript rules");
	});
});
