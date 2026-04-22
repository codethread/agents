import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestSession, says, type TestSession, when } from "@marcfargas/pi-test-harness";
import systemPromptExtension from "./index.js";

const CUSTOM_SYSTEM_PROMPT =
	"You are an expert coding assistant operating inside pi, a coding agent harness.";

const tempDirs: string[] = [];
let t: TestSession | undefined;
const originalPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "system-prompt-it-"));
	tempDirs.push(dir);
	return dir;
}

function writeText(filePath: string, value: string) {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, value);
}

function getNotifyMessages(session: TestSession): string[] {
	return session.events.uiCallsFor("notify").map((call) => String(call.args[0]));
}

function getMessagesWithPrefix(session: TestSession, prefix: string): string[] {
	return getNotifyMessages(session)
		.filter((message) => message.startsWith(prefix))
		.map((message) => message.slice(prefix.length));
}

function capturePromptsExtension(pi: any) {
	pi.on("agent_start", (_event: unknown, ctx: any) => {
		ctx.ui.notify(`SYSTEM_PROMPT:${ctx.getSystemPrompt()}`, "info");
	});
}

async function createSystemPromptSession(cwd: string): Promise<TestSession> {
	t = await createTestSession({
		cwd,
		systemPrompt: CUSTOM_SYSTEM_PROMPT,
		extensionFactories: [systemPromptExtension, capturePromptsExtension],
	});

	const agent = (t.session as any).agent;
	if (typeof agent.setTools !== "function") {
		agent.setTools = (tools: unknown[]) => {
			agent.state.tools = tools;
		};
	}

	for (const modelRegistry of [
		(t.session as any).modelRegistry,
		(t.session as any)._modelRegistry,
	]) {
		if (!modelRegistry) continue;
		modelRegistry.hasConfiguredAuth = () => true;
		modelRegistry.isUsingOAuth = () => false;
		modelRegistry.getApiKey = async () => "test-key";
		modelRegistry.getApiKeyForProvider = async () => "test-key";
		modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "test-key" });
	}

	return t;
}

afterEach(() => {
	t?.dispose();
	t = undefined;
	process.env.PI_CODING_AGENT_DIR = originalPiCodingAgentDir;
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("system-prompt harness integration", () => {
	it("assembles owned scaffold, template sections, and project structure through the merged entrypoint", async () => {
		const cwd = makeTempDir();
		const agentDir = makeTempDir();
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writeText(path.join(agentDir, "agent.njk"), "Use GitHub globally.");
		writeText(path.join(cwd, ".pi", "agent.njk"), "Use issue labels in this repo.");
		writeText(path.join(cwd, "README.md"), "# Demo repo\n");
		writeText(path.join(cwd, "src", "index.ts"), "export const demo = true;\n");

		const session = await createSystemPromptSession(cwd);

		await session.run(when("ping", [says("pong")]));

		const [systemPrompt] = getMessagesWithPrefix(session, "SYSTEM_PROMPT:");
		expect(systemPrompt).toContain('<system-reminder type="harness">');
		expect(systemPrompt).toContain(
			"You help users by reading files, executing commands, editing code, and writing new files.",
		);
		expect(systemPrompt).toContain(
			'<system-reminder type="rules">\nUse GitHub globally.\n</system-reminder>',
		);
		expect(systemPrompt).toContain(
			'<system-reminder type="project-rules">\nUse issue labels in this repo.\n</system-reminder>',
		);
		expect(systemPrompt).toContain('<system-reminder type="project-structure">');
		expect(systemPrompt).toContain("README.md");
		expect(systemPrompt).toContain("src");
	});
});
