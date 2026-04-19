import { wrapSystemReminder } from "../shared/xml.js";

export const MAX_PROJECT_STRUCTURE_LINES = 200;
const TREE_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 5_000;

export interface ExecResultLike {
	stdout: string;
	stderr?: string;
	code: number;
	killed?: boolean;
}

export type ExecLike = (
	command: string,
	args: string[],
	options?: {
		signal?: AbortSignal;
		timeout?: number;
	},
) => Promise<ExecResultLike>;

export interface ProjectStructureSnapshot {
	fileCount: number;
	folderCount?: number;
	treeLineCount: number;
	tree: string;
	showsFullTree: boolean;
	truncated: boolean;
	note?: string;
}

function trimTrailingNewlines(text: string): string {
	return text.replace(/(?:\r?\n)+$/, "");
}

export function countRenderedLines(text: string): number {
	const trimmed = trimTrailingNewlines(text);
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\r?\n/).length;
}

export function countPathLines(text: string): number {
	const trimmed = trimTrailingNewlines(text);
	if (trimmed.length === 0) return 0;
	return trimmed.split(/\r?\n/).filter((line) => line.length > 0).length;
}

export function normalizeTreeOutput(output: string): string {
	const trimmed = trimTrailingNewlines(output);
	if (trimmed.length === 0) return ".";

	const lines = trimmed.split(/\r?\n/);
	lines[0] = ".";
	return lines.join("\n");
}

export function truncateTreeOutput(output: string, maxLines: number): string {
	const normalized = normalizeTreeOutput(output);
	const lines = normalized.split("\n");
	return lines.slice(0, maxLines).join("\n");
}

async function execOrThrow(
	exec: ExecLike,
	command: string,
	args: string[],
	options?: {
		signal?: AbortSignal;
		timeout?: number;
	},
): Promise<ExecResultLike> {
	const result = await exec(command, args, options);
	if (result.code === 0) return result;

	const stderr = result.stderr?.trim();
	const suffix = stderr ? `: ${stderr}` : "";
	throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}${suffix}`);
}

export async function resolveRepoRoot(
	cwd: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<string> {
	const result = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		signal,
		timeout: GIT_TIMEOUT_MS,
	});
	if (result.code !== 0) return cwd;

	const repoRoot = result.stdout.trim();
	return repoRoot.length > 0 ? repoRoot : cwd;
}

export async function countRepoFiles(
	repoRoot: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<number> {
	const result = await execOrThrow(exec, "fd", ["-t", "f", ".", repoRoot], {
		signal,
		timeout: TREE_TIMEOUT_MS,
	});
	return countPathLines(result.stdout);
}

export async function countRepoFolders(
	repoRoot: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<number> {
	const result = await execOrThrow(exec, "fd", ["-t", "d", ".", repoRoot], {
		signal,
		timeout: TREE_TIMEOUT_MS,
	});
	return countPathLines(result.stdout);
}

export async function renderTree(
	repoRoot: string,
	exec: ExecLike,
	depth?: number,
	signal?: AbortSignal,
): Promise<string> {
	const args = ["--charset=ascii", "--gitignore"];
	if (depth !== undefined) args.push("-L", String(depth));
	args.push(repoRoot);

	const result = await execOrThrow(exec, "tree", args, {
		signal,
		timeout: TREE_TIMEOUT_MS,
	});
	return normalizeTreeOutput(result.stdout);
}

function pluralize(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export async function createProjectStructureSnapshot(
	cwd: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<ProjectStructureSnapshot> {
	const repoRoot = await resolveRepoRoot(cwd, exec, signal);
	const fileCount = await countRepoFiles(repoRoot, exec, signal);

	if (fileCount < MAX_PROJECT_STRUCTURE_LINES) {
		const tree = await renderTree(repoRoot, exec, undefined, signal);
		return {
			fileCount,
			treeLineCount: countRenderedLines(tree),
			tree,
			showsFullTree: true,
			truncated: false,
		};
	}

	const folderCount = await countRepoFolders(repoRoot, exec, signal);

	for (const depth of [3, 2, 1]) {
		const tree = await renderTree(repoRoot, exec, depth, signal);
		const treeLineCount = countRenderedLines(tree);
		if (treeLineCount <= MAX_PROJECT_STRUCTURE_LINES) {
			return {
				fileCount,
				folderCount,
				treeLineCount,
				tree,
				showsFullTree: false,
				truncated: false,
			};
		}

		if (depth === 1) {
			return {
				fileCount,
				folderCount,
				treeLineCount: MAX_PROJECT_STRUCTURE_LINES,
				tree: truncateTreeOutput(tree, MAX_PROJECT_STRUCTURE_LINES),
				showsFullTree: false,
				truncated: true,
				note: `Preview truncated to the first ${MAX_PROJECT_STRUCTURE_LINES} lines.`,
			};
		}
	}

	throw new Error("Unable to select a tree depth for the project structure snapshot.");
}

export function formatProjectStructurePrompt(snapshot: ProjectStructureSnapshot): string {
	const lines = [
		"## Project structure",
		"Use this as a navigation aid only; inspect files before relying on details.",
	];

	if (snapshot.showsFullTree) {
		lines.push(`Visible file count: ${snapshot.fileCount}`);
	} else {
		lines.push(
			`Full project structure not shown (${pluralize(snapshot.fileCount, "file", "files")}, ${pluralize(snapshot.folderCount ?? 0, "folder", "folders")}).`,
		);
	}

	if (snapshot.note) lines.push(snapshot.note);

	lines.push("", "```text", snapshot.tree, "```");
	return wrapSystemReminder("project-structure", lines.join("\n"));
}

export async function buildProjectStructurePrompt(
	cwd: string,
	exec: ExecLike,
	signal?: AbortSignal,
): Promise<string> {
	const snapshot = await createProjectStructureSnapshot(cwd, exec, signal);
	return formatProjectStructurePrompt(snapshot);
}
