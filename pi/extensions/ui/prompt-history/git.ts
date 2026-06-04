import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PromptHistoryGitContext {
	cwd: string;
	repoRoot: string;
}

function getGitFailureMessage(stdout: string, stderr: string, code: number): string {
	return stderr.trim() || stdout.trim() || `git exited with code ${code}`;
}

export function parseCanonicalRepoRoot(commonDirOutput: string): string | undefined {
	const trimmed = commonDirOutput.trim();
	if (!trimmed) return undefined;
	const resolved = path.resolve(trimmed);
	return path.basename(resolved) === ".git" ? path.dirname(resolved) : resolved;
}

export async function resolvePromptHistoryGitContext(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	signal?: AbortSignal,
): Promise<PromptHistoryGitContext | undefined> {
	const insideResult = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd,
		signal,
		timeout: 5000,
	});
	if (insideResult.code !== 0 || insideResult.stdout.trim() !== "true") return undefined;

	const commonDirResult = await pi.exec(
		"git",
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		{
			cwd,
			signal,
			timeout: 5000,
		},
	);
	if (commonDirResult.code !== 0) {
		throw new Error(
			`Failed to resolve prompt-history git common dir: ${getGitFailureMessage(commonDirResult.stdout, commonDirResult.stderr, commonDirResult.code)}`,
		);
	}

	const repoRoot = parseCanonicalRepoRoot(commonDirResult.stdout);
	if (!repoRoot) {
		throw new Error("Failed to parse prompt-history git common dir output.");
	}

	return { cwd, repoRoot };
}
