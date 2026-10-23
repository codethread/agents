import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["**/*.{test,spec}.ts"],
		exclude: [...configDefaults.exclude, ".worktrees/**", ".claude/skills/**"],
		server: {
			deps: {
				inline: ["@gaodes/pi-test-harness"],
			},
		},
	},
});
