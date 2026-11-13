import { createLake } from "@botlake/core";
import batteriesExtension from "@botlake/extension-batteries";
import identityExtension from "@botlake/extension-identity";
import flags from "./src/flags.ts";
import references from "./src/references.ts";
import agents from "./src/agents.ts";
import priming from "./src/priming.ts";
import work from "./src/work.ts";
import workAgents from "./src/work-agents.ts";
import { ui } from "@botlake/extension-ct-config";

export const lake = createLake({
	name: "agents",
	minimumCore: "0.3.3",
	extensions: [
		batteriesExtension,
		identityExtension,
		flags,
		references,
		agents,
		priming,
		work,
		workAgents,
		ui,
	],
});
