import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repository lake", () => {
	it("selects unique configured descriptors with the shared Agents and Work bindings", () => {
		const result = JSON.parse(
			execFileSync(
				"bun",
				[
					"-e",
					`import * as configured from "@botlake/extension-ct-config";
import {lake} from "./lake.ts";
import agents from "./src/agents.ts";
import work from "./src/work.ts";
const extensions = new Map(lake.extensions.map((extension) => [extension.name, extension]));
console.log(JSON.stringify({
  exactAgents: agents === configured.agents && extensions.get("agents") === agents,
  exactWork: work === configured.work && extensions.get("work") === work,
  exactBindings: ["agents", "flags", "references", "priming", "work", "workAgents", "mail", "mailIdentity", "mailAgents", "ui"].every((key) => extensions.get(configured[key].name) === configured[key]),
  count: lake.extensions.length,
  names: [...extensions.keys()],
  mailAgentRequires: extensions.get("mail-agents")?.requires,
  agentRequires: agents.requires,
}));`,
				],
				{ cwd: import.meta.dirname, encoding: "utf8" },
			),
		) as {
			exactAgents: boolean;
			exactWork: boolean;
			exactBindings: boolean;
			count: number;
			names: string[];
			mailAgentRequires: string[];
			agentRequires: string[];
		};

		expect(result.exactAgents).toBe(true);
		expect(result.exactWork).toBe(true);
		expect(result.exactBindings).toBe(true);
		expect(result.count).toBe(result.names.length);
		expect(result.names.filter((name) => name === "ui")).toHaveLength(1);
		expect(result.names).toEqual(expect.arrayContaining(["mail", "mail-identity", "mail-agents"]));
		expect(result.mailAgentRequires).toEqual(["mail", "agents"]);
		expect(result.agentRequires).not.toContain("mail");
	});
});
