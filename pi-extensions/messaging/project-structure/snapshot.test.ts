import { describe, expect, it } from "vitest";
import { buildProjectStructurePrompt, resolveRepoRoot, type ExecLike } from "./snapshot.js";

function makeLines(count: number, prefix: string): string {
	return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`).join("\n");
}

function makeTreeOutput(root: string, lineCount: number): string {
	const lines = [
		root,
		...Array.from({ length: Math.max(0, lineCount - 1) }, (_, index) => `node-${index + 1}`),
	];
	return `${lines.join("\n")}\n`;
}

function createExecMock(options: {
	repoRoot?: string;
	gitCode?: number;
	fileCount: number;
	folderCount?: number;
	fullTree?: string;
	depthTrees?: Partial<Record<1 | 2 | 3, string>>;
}): ExecLike {
	return async (command, args) => {
		if (command === "git") {
			if (options.gitCode && options.gitCode !== 0) {
				return { code: options.gitCode, stdout: "", stderr: "not a git repo" };
			}
			return { code: 0, stdout: `${options.repoRoot ?? "/repo"}\n`, stderr: "" };
		}

		if (command === "fd") {
			const typeIndex = args.indexOf("-t");
			const type = typeIndex === -1 ? undefined : args[typeIndex + 1];
			if (type === "d") {
				return {
					code: 0,
					stdout: `${makeLines(options.folderCount ?? 0, "dir")}\n`,
					stderr: "",
				};
			}
			return { code: 0, stdout: `${makeLines(options.fileCount, "file")}\n`, stderr: "" };
		}

		if (command === "tree") {
			const depthIndex = args.indexOf("-L");
			if (depthIndex === -1) {
				return {
					code: 0,
					stdout: options.fullTree ?? makeTreeOutput(options.repoRoot ?? "/repo", 10),
					stderr: "",
				};
			}

			const depth = Number(args[depthIndex + 1]) as 1 | 2 | 3;
			const tree = options.depthTrees?.[depth];
			if (!tree) throw new Error(`Missing mocked tree output for depth ${depth}`);
			return { code: 0, stdout: tree, stderr: "" };
		}

		throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
	};
}

describe("resolveRepoRoot", () => {
	it("falls back to cwd when git root lookup fails", async () => {
		const exec = createExecMock({ fileCount: 0, gitCode: 128 });
		await expect(resolveRepoRoot("/work/subdir", exec)).resolves.toBe("/work/subdir");
	});
});

describe("buildProjectStructurePrompt", () => {
	it("shows the full tree when the repo has fewer than 200 files", async () => {
		const exec = createExecMock({
			fileCount: 199,
			fullTree: [
				"/repo",
				"|-- package.json",
				"|-- README.md",
				"|-- src",
				"|   |-- index.ts",
				"|   `-- features",
				"|       |-- auth.ts",
				"|       `-- billing",
				"|           `-- invoice.ts",
				"`-- test",
				"    `-- fixtures",
				"        `-- users.json",
				"",
			].join("\n"),
		});

		const prompt = await buildProjectStructurePrompt("/repo", exec);

		expect(prompt).toMatchSnapshot();
	});

	it("starts at -L 3 and falls back to -L 2 when needed", async () => {
		const exec = createExecMock({
			fileCount: 250,
			folderCount: 40,
			depthTrees: {
				3: makeTreeOutput("/repo", 201),
				2: makeTreeOutput("/repo", 180),
			},
		});

		const prompt = await buildProjectStructurePrompt("/repo", exec);

		expect(prompt).toMatchSnapshot();
	});

	it("truncates the -L 1 tree when even that exceeds the line budget", async () => {
		const exec = createExecMock({
			fileCount: 500,
			folderCount: 120,
			depthTrees: {
				3: makeTreeOutput("/repo", 260),
				2: makeTreeOutput("/repo", 230),
				1: makeTreeOutput("/repo", 220),
			},
		});

		const prompt = await buildProjectStructurePrompt("/repo", exec);

		expect(prompt).toMatchSnapshot();
	});
});
