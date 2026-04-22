import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestSession, says, type TestSession, when } from "@marcfargas/pi-test-harness";
import piDiscoveryExtension from "./index.js";

const CUSTOM_SYSTEM_PROMPT =
	"You are an expert coding assistant operating inside pi, a coding agent harness.";

const tempDirs: string[] = [];
let t: TestSession | undefined;
const originalPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), "pi-discovery-it-"));
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
	pi.on("before_agent_start", (event: any, ctx: any) => {
		ctx.ui.notify(`PROMPT:${event.prompt}`, "info");
	});
}

async function createPiDiscoverySession(cwd: string): Promise<TestSession> {
	t = await createTestSession({
		cwd,
		systemPrompt: CUSTOM_SYSTEM_PROMPT,
		extensionFactories: [piDiscoveryExtension, capturePromptsExtension],
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

describe("pi-discovery harness integration", () => {
	it("injects the Pi discovery note only on the first standalone Pi mention", async () => {
		const cwd = makeTempDir();
		const agentDir = makeTempDir();
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeText(path.join(cwd, "README.md"), "# Demo repo\n");

		const session = await createPiDiscoverySession(cwd);

		await session.run(
			when("Tell me about Pi internals", [says("First answer")]),
			when("Pi again please", [says("Second answer")]),
		);

		const prompts = getMessagesWithPrefix(session, "PROMPT:");
		expect(prompts).toHaveLength(2);
		expect(prompts[0]).toContain("Tell me about Pi internals");
		expect(prompts[0]).toContain("<pi-extension-discovery");
		expect(prompts[1]).toContain("Pi again please");
		expect(prompts[1]).not.toContain("<pi-extension-discovery");
	});
});
