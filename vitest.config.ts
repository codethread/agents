import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["**/*.{test,spec}.ts"],
		server: {
			deps: {
				inline: ["@gaodes/pi-test-harness"],
			},
		},
	},
});
