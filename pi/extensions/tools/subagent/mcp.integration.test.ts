import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createCodemodeExtension,
	createMcpExtension,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { createTestSession, calls, says, when, type TestSession } from "@gaodes/pi-test-harness";
import { expect, it, vi } from "vitest";
import { disposeMcpRegistrations, setupAgentMcpServers } from "./mcp-runtime.js";

it("connects an agent-local stdio server and calls it through native codemode", async () => {
	const directory = await mkdtemp(join(tmpdir(), "agent-native-mcp-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", directory);
	let session: TestSession | undefined;
	let api: ExtensionAPI | undefined;
	let registrations: string[] = [];
	try {
		session = await createTestSession({
			cwd: directory,
			extensionFactories: [
				// Match CLI/Pies ordering: agent registrations run before native MCP startup.
				(pi: ExtensionAPI) => {
					api = pi;
					pi.on("session_start", () => {
						const setup = setupAgentMcpServers(pi, {
							name: "fixture",
							description: "MCP fixture",
							hidden: false,
							tools: [],
							systemPrompt: "Echo values.",
							source: "project",
							filePath: "/tmp/fixture.md",
							mcpServers: [
								{
									name: "fixture",
									command: process.execPath,
									args: [fileURLToPath(new URL("./__fixtures__/mcp-server.mjs", import.meta.url))],
								},
							],
						});
						registrations = setup.registrations;
						pi.setActiveTools(setup.toolNames);
					});
					pi.on("session_shutdown", () => disposeMcpRegistrations(pi, registrations));
				},
				createCodemodeExtension(),
				createMcpExtension(),
			],
		});
		await session.run(
			when("Echo pong through MCP.", [
				calls("codemode", { code: 'return await tools.mcp__fixture__echo({value: "pong"});' }),
				says("done"),
			]),
		);
		expect(session.events.toolResultsFor("codemode")[0]).toMatchObject({
			isError: false,
			mocked: false,
			text: expect.stringContaining("native-mcp:pong"),
		});
		expect(api!.getMcpServers().map((server) => server.name)).toEqual(["fixture"]);
		await session.session.extensionRunner.emit({ type: "session_shutdown" });
		expect(api!.getMcpServers()).toEqual([]);
	} finally {
		if (session) {
			await session.session.extensionRunner.emit({ type: "session_shutdown" });
			session.dispose();
		}
		vi.unstubAllEnvs();
		await rm(directory, { recursive: true, force: true });
	}
}, 15000);
