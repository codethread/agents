import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	expandHomePrefix,
	findGlobalTemplate,
	findNearestProjectTemplate,
	findNearestTemplate,
	getGlobalTemplatePath,
	getPiCodingAgentDir,
	renderNearestTemplate,
	renderTemplate,
	renderTemplateSections,
	stripEmptyLines,
} from "./parser.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-agents-md-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("template discovery", () => {
	it("findNearestProjectTemplate prefers the nearest local .pi/agent.njk file", async () => {
		const root = await makeTempDir();
		const nested = path.join(root, "apps", "web", "src");
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(path.join(root, "apps", "web", ".pi"), { recursive: true });
		await fs.mkdir(nested, { recursive: true });
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "root");
		await fs.writeFile(path.join(root, "apps", "web", ".pi", "agent.njk"), "nested");

		const match = await findNearestProjectTemplate(nested);

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

	it("findNearestTemplate still prefers the local template over global fallback", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "local");
		await fs.writeFile(path.join(agentDir, "agent.njk"), "global");

		try {
			const match = await findNearestTemplate(root);

			expect(match).toEqual({
				filePath: path.join(root, ".pi", "agent.njk"),
				scope: "project",
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

	it("supports the has_tools filter against the tools template var", () => {
		const rendered = renderTemplate(
			'{% if tools | has_tools(["read", "write"]) %}match{% else %}miss{% endif %}',
			{ tools: ["read", "bash", "write"] },
		);

		expect(rendered).toBe("match");
	});

	it("supports the has_tools global helper", () => {
		const rendered = renderTemplate(
			'{% if has_tools(["read", "write"]) %}match{% else %}miss{% endif %}',
			{ tools: ["read", "bash", "write"] },
		);

		expect(rendered).toBe("match");
	});

	it("supports single-tool has_tools checks", () => {
		const rendered = renderTemplate('{% if has_tools("read") %}match{% else %}miss{% endif %}', {
			tools: ["read", "write"],
		});

		expect(rendered).toBe("match");
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

describe("expandHomePrefix", () => {
	it("expands ~ and ~/ prefixes", () => {
		expect(expandHomePrefix("~")).toBe(os.homedir());
		expect(expandHomePrefix("~/dev/projects/")).toBe(
			`${path.join(os.homedir(), "dev", "projects")}/`,
		);
	});
});

describe("Pi agent dir helpers", () => {
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

describe("renderNearestTemplate", () => {
	it("renders a single project template inside a project-rules system_reminder", async () => {
		const root = await makeTempDir();
		const cwd = path.join(root, "packages", "api");
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(cwd, { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(
			path.join(root, ".pi", "agent.njk"),
			"\nProvider: {{ provider }}\n\nModel: {{ model }}\n",
		);

		try {
			const rendered = await renderNearestTemplate(cwd, {
				provider: "openai",
				model: "gpt-5",
			});

			expect(rendered).toEqual({
				filePath: path.join(root, ".pi", "agent.njk"),
				renderedPrompt:
					'<system-reminder type="project-rules">\nProvider: openai\nModel: gpt-5\n</system-reminder>',
			});
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
			const rendered = await renderNearestTemplate(cwd, {});

			expect(rendered).toEqual({
				filePath: path.join(root, ".pi", "agent.njk"),
				renderedPrompt:
					'<system-reminder type="rules">\nUse GitHub globally.\n</system-reminder>\n\n<system-reminder type="project-rules">\nUse issue labels in this repo.\n</system-reminder>',
			});
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("returns null when all rendered templates are empty after stripping", async () => {
		const root = await makeTempDir();
		const agentDir = path.join(root, "custom-agent-dir");
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await fs.mkdir(path.join(root, ".pi"), { recursive: true });
		await fs.mkdir(agentDir, { recursive: true });
		await fs.writeFile(path.join(root, ".pi", "agent.njk"), "\n\n   \n");

		try {
			const rendered = await renderNearestTemplate(root, {});

			expect(rendered).toBeNull();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});
});
