import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testHarnessPi = fileURLToPath(import.meta.resolve("@codethread/pi-coding-agent-test"));
const testHarnessAgentCore = fileURLToPath(import.meta.resolve("@codethread/pi-agent-core-test"));
// Test aliases track the runtime SDK. The pnpm patch adapts
// @gaodes/pi-test-harness 1.0.3 to Pi 0.86's model/auth APIs.
const testHarnessAi = fileURLToPath(import.meta.resolve("@codethread/pi-ai-test"));
const testHarnessTui = fileURLToPath(import.meta.resolve("@codethread/pi-tui-test"));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@earendil-works\/pi-agent-core$/,
				replacement: testHarnessAgentCore,
			},
			{
				find: /^@earendil-works\/pi-ai$/,
				replacement: testHarnessAi,
			},
			{
				find: /^@earendil-works\/pi-coding-agent$/,
				replacement: testHarnessPi,
			},
			{
				find: /^@earendil-works\/pi-tui$/,
				replacement: testHarnessTui,
			},
		],
	},
	test: {
		include: ["**/*.{test,spec}.ts"],
		server: {
			deps: {
				inline: ["@gaodes/pi-test-harness"],
			},
		},
	},
});
