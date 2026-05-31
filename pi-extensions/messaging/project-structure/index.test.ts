import { describe, expect, it, vi } from "vitest";
import projectStructureExtension from "./index.js";

function createExecMock(tree: string) {
	return vi.fn(async (command: string, args: string[]) => {
		if (command === "git") return { code: 0, stdout: "/repo\n", stderr: "" };
		if (command === "fd") return { code: 0, stdout: "package.json\nsrc/index.ts\n", stderr: "" };
		if (command === "tree") return { code: 0, stdout: tree, stderr: "" };
		throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
	});
}

function createCtx(branch: Array<{ type: string }> = []) {
	return {
		cwd: "/repo",
		hasUI: true,
		ui: {},
		sessionManager: {
			getBranch: () => branch,
		},
	};
}

describe("project-structure messaging extension", () => {
	it("sends the project tree as a custom message separate from the system prompt", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		const registerMessageRenderer = vi.fn();

		projectStructureExtension({
			exec: createExecMock("/repo\n|-- package.json\n`-- src\n    `-- index.ts\n"),
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerMessageRenderer,
		} as any);

		const ctx = createCtx();
		await handlers.get("session_start")?.({}, ctx);
		const result = await handlers.get("before_agent_start")?.({ systemPrompt: "Base prompt" }, ctx);

		expect(registerMessageRenderer).toHaveBeenCalledWith("project-structure", expect.any(Function));
		expect(result).toMatchInlineSnapshot(`
			{
			  "message": {
			    "content": "<system-reminder type="project-structure">
			## Project structure
			Use this as a navigation aid only; inspect files before relying on details.
			Visible file count: 2

			\`\`\`text
			.
			|-- package.json
			\`-- src
			    \`-- index.ts
			\`\`\`
			</system-reminder>",
			    "customType": "project-structure",
			    "display": true,
			  },
			}
		`);
	});

	it("only sends the project tree for the first chat message", async () => {
		const handlers = new Map<string, (event: any, ctx: any) => unknown | Promise<unknown>>();
		let tree = "/repo\n`-- package.json\n";

		const exec = vi.fn(async (command: string, args: string[]) => {
			if (command === "git") return { code: 0, stdout: "/repo\n", stderr: "" };
			if (command === "fd") return { code: 0, stdout: "package.json\nsrc/index.ts\n", stderr: "" };
			if (command === "tree") return { code: 0, stdout: tree, stderr: "" };
			throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
		});
		projectStructureExtension({
			exec,
			on(eventName: string, handler: (event: any, ctx: any) => unknown | Promise<unknown>) {
				handlers.set(eventName, handler);
			},
			registerMessageRenderer: vi.fn(),
		} as any);

		const branch: Array<{ type: string }> = [];
		const ctx = createCtx(branch);
		await handlers.get("session_start")?.({}, ctx);

		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeDefined();
		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeUndefined();

		tree = "/repo\n|-- package.json\n`-- src\n    `-- index.ts\n";
		branch.push({ type: "message" });
		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeUndefined();
	});
});
