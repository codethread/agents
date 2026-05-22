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

		await handlers.get("session_start")?.({}, { cwd: "/repo", hasUI: true, ui: {} });
		const result = await handlers.get("before_agent_start")?.(
			{ systemPrompt: "Base prompt" },
			{ cwd: "/repo", hasUI: true, ui: {} },
		);

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

	it("does not resend an unchanged project tree, but sends a changed tree after invalidation", async () => {
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

		const ctx = { cwd: "/repo", hasUI: true, ui: {} };
		await handlers.get("session_start")?.({}, ctx);

		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeDefined();
		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeUndefined();

		tree = "/repo\n|-- package.json\n`-- src\n    `-- index.ts\n";
		await handlers.get("tool_execution_end")?.({ toolName: "bash" }, ctx);
		await expect(handlers.get("before_agent_start")?.({}, ctx)).resolves.toBeDefined();
	});
});
