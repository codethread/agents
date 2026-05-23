import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	expandHomePrefix,
	findGlobalTemplate,
	findProjectTemplate,
	getGlobalTemplatePath,
	getPiCodingAgentDir,
	getTemplateVars,
	parseDebugPromptOverrides,
	renderDynamicPrompt,
	renderTemplate,
	renderTemplateSections,
	renderTemplates,
	stripEmptyLines,
} from "./templates.js";

const tempDirs: string[] = [];
const originalPiSubagent = process.env.PI_SUBAGENT;

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "system-prompt-templates-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	if (originalPiSubagent === undefined) delete process.env.PI_SUBAGENT;
	else process.env.PI_SUBAGENT = originalPiSubagent;
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("parseDebugPromptOverrides", () => {
	it("returns null overrides for bare --debug-prompt", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt"])).toEqual({
			overrides: null,
			error: null,
		});
	});

	it("parses JSON from a separate argument", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", '{"model":"claude-sonnet"}'])).toEqual({
			overrides: { model: "claude-sonnet" },
			error: null,
		});
	});

	it("parses JSON from --debug-prompt=<json>", () => {
		expect(parseDebugPromptOverrides(['--debug-prompt={"model":"claude-sonnet"}'])).toEqual({
			overrides: { model: "claude-sonnet" },
			error: null,
		});
	});

	it("ignores non-JSON-looking values to preserve bare-flag behavior", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", "ping"])).toEqual({
			overrides: null,
			error: null,
		});
	});

	it("rejects invalid object JSON", () => {
		expect(parseDebugPromptOverrides(["--debug-prompt", '{"model":}'])).toEqual({
			overrides: null,
			error: expect.stringContaining("Invalid --debug-prompt JSON:"),
		});
	});
});

describe("getTemplateVars", () => {
	it("marks the top-level runtime as the main agent by default", () => {
		delete process.env.PI_SUBAGENT;
		const vars = getTemplateVars({
			cwd: "/repo",
			hasUI: true,
			tools: ["read"],
		});

		expect(vars).toMatchObject({
			isMainAgent: true,
			isSubagent: false,
		});
	});

	it("marks delegated runtimes as subagents", () => {
		process.env.PI_SUBAGENT = "1";
		const vars = getTemplateVars({
			cwd: "/repo",
			hasUI: false,
			tools: ["read"],
		});

		expect(vars).toMatchObject({
			isMainAgent: false,
			isSubagent: true,
		});
	});

	it("lets overrides replace machine-derived vars", () => {
		const vars = getTemplateVars(
			{
				cwd: "/repo",
				hasUI: true,
				tools: ["read", "write"],
				model: {
					provider: "openai",
					id: "gpt-5",
				},
			},
			{
				model: "claude-sonnet",
				HOME: "/tmp/fake-home",
				isMainAgent: false,
			},
		);

		expect(vars).toMatchObject({
			provider: "openai",
			model: "claude-sonnet",
			cwd: "/repo",
			hasUI: true,
			isMainAgent: false,
			tools: ["read", "write"],
			HOME: "/tmp/fake-home",
		});
	});
});

describe("template discovery", () => {
	it("findProjectTemplate prefers the nearest local .pi/agent.njk file", async () => {
		const root = await makeTempDir();
		const nested = path.join(root, "apps", "web", "src");
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(path.join(root, "apps", "web", ".pi"), { recursive: true });
		await fs.mkdir(nested, { recursive: true });
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "root");
		await fs.writeFile(path.join(root, "apps", "web", ".pi", "agent.njk"), "nested");

		const match = await findProjectTemplate(nested);

		expect(match).toEqual({
			filePath: path.join(root, "apps", "web", ".pi", "agent.njk"),
			scope: "project",
		});
	});

	it("findGlobalTemplate uses the global template in PI_CODING_AGENT_DIR", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(agentDir, "agent.njk"), "global");

		try {
			const match = await findGlobalTemplate();

			expect(match).toEqual({
				filePath: path.join(agentDir, "agent.njk"),
				scope: "global",
			});
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});

describe("renderTemplate", () => {
	it("supports the regex_test filter", () => {
		const rendered = renderTemplate(
			'{% if provider | regex_test("^openai$") %}match{% else %}miss{% endif %}',
			{ provider: "openai" },
		);

		expect(rendered).toBe("match");
	});

	it("supports has_tools as a filter and global helper", () => {
		expect(
			renderTemplate('{% if tools | has_tools(["read", "write"]) %}match{% endif %}', {
				tools: ["read", "bash", "write"],
			}),
		).toBe("match");
		expect(
			renderTemplate('{% if has_tools("read") %}match{% endif %}', {
				tools: ["read", "write"],
			}),
		).toBe("match");
	});

	it("returns false when any required tool is missing", () => {
		const rendered = renderTemplate(
			'{% if has_tools(["read", "edit"]) %}match{% else %}miss{% endif %}',
			{ tools: ["read", "write"] },
		);

		expect(rendered).toBe("miss");
	});

	it("can render hasUI-dependent template branches", () => {
		const rendered = renderTemplate("{% if hasUI %}interactive{% else %}headless{% endif %}", {
			hasUI: true,
		});

		expect(rendered).toBe("interactive");
	});

	it("expands ~/ in regex_test patterns", () => {
		const cwd = path.join(os.homedir(), "dev", "projects", "agents");
		const rendered = renderTemplate(
			[
				'{% if cwd | regex_test("~/work/") %}',
				"Use GitLab for all version control.",
				'{% elif cwd | regex_test("~/dev/projects/") %}',
				"Use GitHub for all version control.",
				"{% endif %}",
			].join("\n"),
			{ cwd },
		);

		expect(stripEmptyLines(rendered)).toBe("Use GitHub for all version control.");
	});
});

describe("path helpers", () => {
	it("expands ~ and ~/ prefixes", () => {
		expect(expandHomePrefix("~")).toBe(os.homedir());
		expect(expandHomePrefix("~/dev/projects/")).toBe(
			`${path.join(os.homedir(), "dev", "projects")}/`,
		);
	});

	it("uses PI_CODING_AGENT_DIR when set", () => {
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = "/tmp/custom-pi-agent-dir";

		try {
			expect(getPiCodingAgentDir()).toBe("/tmp/custom-pi-agent-dir");
			expect(getGlobalTemplatePath()).toBe("/tmp/custom-pi-agent-dir/agent.njk");
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});

describe("stripEmptyLines", () => {
	it("removes blank lines and trims surrounding whitespace", () => {
		expect(stripEmptyLines("\n  first  \n\nsecond\t\n   \n")).toBe("first\nsecond");
	});
});

describe("renderTemplateSections", () => {
	it("renders global rules first, then project rules, with system_reminder types", async () => {
		const root = await makeTempDir();
		const cwd = path.join(root, "packages", "api");
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(agentDir, "agent.njk"), "Global: {{ provider }}");
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "Project: {{ model }}");

		try {
			const sections = await renderTemplateSections(cwd, {
				provider: "openai",
				model: "gpt-5",
			});

			expect(sections).toEqual([
				{
					scope: "global",
					reminderType: "rules",
					filePath: path.join(agentDir, "agent.njk"),
					renderedPrompt: "Global: openai",
				},
				{
					scope: "project",
					reminderType: "project-rules",
					filePath: path.join(root, ".pi", "agent.njk"),
					renderedPrompt: "Project: gpt-5",
				},
			]);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});

describe("renderTemplates", () => {
	it("renders a single project template inside a project-rules system_reminder", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "empty-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const cwd = path.join(root, "packages", "api");
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(
			path.join(root, ".pi", "agent.njk"),
			"\nProvider: {{ provider }}\n\nModel: {{ model }}\n",
		);

		try {
			const rendered = await renderTemplates(cwd, {
				provider: "openai",
				model: "gpt-5",
			});

			expect(rendered).toBe(
				'<system-reminder type="project-rules">\nProvider: openai\nModel: gpt-5\n</system-reminder>',
			);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("merges global and project templates as separate system_reminder blocks", async () => {
		const root = await makeTempDir();
		const cwd = path.join(root, "packages", "api");
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(agentDir, "agent.njk"), "Use GitHub globally.");
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "Use issue labels in this repo.");

		try {
			const rendered = await renderTemplates(cwd, {});

			expect(rendered).toBe(
				'<system-reminder type="rules">\nUse GitHub globally.\n</system-reminder>\n\n<system-reminder type="project-rules">\nUse issue labels in this repo.\n</system-reminder>',
			);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("returns null when all rendered templates are empty after stripping", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "empty-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "\n\n   \n");

		try {
			const rendered = await renderTemplates(root, {});

			expect(rendered).toBeNull();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});

describe("renderDynamicPrompt", () => {
	it("renders templates with computed vars", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "empty-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(
			path.join(root, ".pi", "agent.njk"),
			"{{ provider }} {{ model }} {{ cwd }} {{ hasUI }} {{ tools | join(',') }}",
		);

		try {
			const result = await renderDynamicPrompt({
				cwd: root,
				hasUI: true,
				tools: ["bash", "edit"],
				model: { provider: "openai", id: "gpt-5" },
			});

			expect(result).toBe(
				`<system-reminder type="project-rules">\nopenai gpt-5 ${root} true bash,edit\n</system-reminder>`,
			);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});
