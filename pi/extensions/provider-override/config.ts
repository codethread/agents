import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export interface ProviderOverridePathRule {
	path: string;
	provider: string;
}

export interface ProviderOverrideConfig {
	providers: string[];
	default: string;
	paths: ProviderOverridePathRule[];
}

const pathRuleSchema = z.object({
	path: z.string().trim().min(1),
	provider: z.string().trim().min(1),
});

const configSchema = z
	.object({
		providers: z.array(z.string().trim().min(1)).min(2),
		default: z.string().trim().min(1),
		paths: z.array(pathRuleSchema).default([]),
	})
	.strict();

export function getGlobalSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.HOME || env.USERPROFILE;
	if (!home) throw new Error("Cannot load provider override config: HOME is not set");
	return path.join(home, ".pi", "agent", "extensions", "pi-provider", "settings.json");
}

function expandHome(input: string, env: NodeJS.ProcessEnv): string {
	const home = env.HOME || env.USERPROFILE;
	if (input === "~") {
		if (!home) throw new Error(`Cannot expand path "${input}": HOME is not set`);
		return home;
	}
	if (input.startsWith("~/")) {
		if (!home) throw new Error(`Cannot expand path "${input}": HOME is not set`);
		return path.join(home, input.slice(2));
	}
	return input;
}

export function normalizePolicyPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
	const expanded = expandHome(input, env);
	if (!path.isAbsolute(expanded)) {
		throw new Error(`Provider override path "${input}" must be absolute or start with ~/`);
	}
	return path.normalize(expanded).replace(/[\\/]+$/, "") || path.parse(expanded).root;
}

export function normalizeCwd(cwd: string): string {
	const resolved = path.resolve(cwd);
	return path.normalize(resolved).replace(/[\\/]+$/, "") || path.parse(resolved).root;
}

function isDuplicate(value: string, index: number, values: string[]): boolean {
	return values.indexOf(value) !== index;
}

export function parseProviderOverrideConfig(
	raw: unknown,
	env: NodeJS.ProcessEnv = process.env,
): ProviderOverrideConfig {
	const parsed = configSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(`Invalid provider override config: ${z.prettifyError(parsed.error)}`);
	}

	const providers = parsed.data.providers;
	const duplicateProviders = providers.filter(isDuplicate);
	if (duplicateProviders.length > 0) {
		throw new Error(
			`Invalid provider override config: duplicate provider(s): ${Array.from(new Set(duplicateProviders)).join(", ")}`,
		);
	}

	const providerSet = new Set(providers);
	if (!providerSet.has(parsed.data.default)) {
		throw new Error(
			`Invalid provider override config: default provider "${parsed.data.default}" is not listed in providers`,
		);
	}

	return {
		providers,
		default: parsed.data.default,
		paths: parsed.data.paths.map((rule, index) => {
			if (!providerSet.has(rule.provider)) {
				throw new Error(
					`Invalid provider override config: paths[${index}].provider "${rule.provider}" is not listed in providers`,
				);
			}
			return { path: normalizePolicyPath(rule.path, env), provider: rule.provider };
		}),
	};
}

export function loadProviderOverrideConfig(
	settingsPath = getGlobalSettingsPath(),
	env: NodeJS.ProcessEnv = process.env,
): ProviderOverrideConfig {
	if (!existsSync(settingsPath)) {
		throw new Error(`Provider override config not found: ${settingsPath}`);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch (error) {
		throw new Error(
			`Cannot read provider override config at ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parseProviderOverrideConfig(raw, env);
}

export function matchesPathRule(cwd: string, rulePath: string): boolean {
	const normalizedCwd = normalizeCwd(cwd);
	const normalizedRule = normalizeCwd(rulePath);
	return normalizedCwd === normalizedRule || normalizedCwd.startsWith(`${normalizedRule}${path.sep}`);
}

export function getPolicyProvider(config: ProviderOverrideConfig, cwd: string): string {
	const match = config.paths.find((rule) => matchesPathRule(cwd, rule.path));
	return match?.provider ?? config.default;
}
