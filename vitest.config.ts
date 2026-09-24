import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const testHarnessPi = fileURLToPath(import.meta.resolve("@codethread/pi-coding-agent-test"));
const testHarnessAgentCore = fileURLToPath(import.meta.resolve("@codethread/pi-agent-core-test"));
// Test aliases intentionally exercise Pi 0.86.1. The pnpm patch adapts
// @gaodes/pi-test-harness 1.0.3 to that SDK's model/auth APIs.
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
