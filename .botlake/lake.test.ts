import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repository lake", () => {
	it("selects configured Mail delivery with the shared Agents binding", () => {
		const result = JSON.parse(
			execFileSync(
				"bun",
				[
					"-e",
					`import {agents as configuredAgents} from "@botlake/extension-ct-config";
import {lake} from "./lake.ts";
import agents from "./src/agents.ts";
const extensions = new Map(lake.extensions.map((extension) => [extension.name, extension]));
console.log(JSON.stringify({
  exactAgents: agents === configuredAgents && extensions.get("agents") === agents,
  names: [...extensions.keys()],
  mailAgentRequires: extensions.get("mail-agents")?.requires,
}));`,
				],
				{ cwd: import.meta.dirname, encoding: "utf8" },
			),
		) as { exactAgents: boolean; names: string[]; mailAgentRequires: string[] };

		expect(result.exactAgents).toBe(true);
		expect(result.names).toEqual(expect.arrayContaining(["mail", "mail-identity", "mail-agents"]));
		expect(result.mailAgentRequires).toEqual(["mail", "agents"]);
	});
});
