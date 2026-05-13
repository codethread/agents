import path from "node:path";
import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import {
	expandHomePrefix,
	getExtensionNameFromPath,
	normalizeDiscoverySource,
	pathFromModuleSpecifier,
} from "./source-utils.js";

const CONFIG_DIR_NAME = ".pi";

export interface PiExtensionRecord extends SourceInfo {
	name: string;
}

export type PiInspectPackageDirSource = "env" | "runtime-package";

export interface PiSourceDiscovery {
	inspectPackageDir: string;
	inspectPackageDirSource: PiInspectPackageDirSource;
	runtimePackageDir: string;
	runtimePackageEntry: string;
	docsDir: string;
	examplesDir: string;
	coreToolsDir: string;
}

export interface PiExtensionDiscovery {
	agentDir: string;
	globalSettingsPath: string;
	globalExtensionsDir: string;
	projectConfigDir: string;
	projectSettingsPath: string;
	projectExtensionsDir: string;
	piSource: PiSourceDiscovery;
	extensions: PiExtensionRecord[];
}

export function discoverPiSource(): PiSourceDiscovery {
	const runtimePackageEntry = pathFromModuleSpecifier(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const runtimePackageDir = path.resolve(path.dirname(runtimePackageEntry), "..");
	const inspectPackageDirFromEnv = process.env.PI_PACKAGE_DIR
		? path.resolve(expandHomePrefix(process.env.PI_PACKAGE_DIR))
		: null;
	const inspectPackageDir = inspectPackageDirFromEnv ?? runtimePackageDir;

	return {
		inspectPackageDir,
		inspectPackageDirSource: inspectPackageDirFromEnv ? "env" : "runtime-package",
		runtimePackageDir,
		runtimePackageEntry,
		docsDir: path.join(inspectPackageDir, "docs"),
		examplesDir: path.join(inspectPackageDir, "examples"),
		coreToolsDir: path.join(inspectPackageDir, "dist", "core", "tools"),
	};
}

export async function discoverPiExtensions(
	cwd: string,
	agentDir = getAgentDir(),
): Promise<PiExtensionDiscovery> {
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager,
	});
	const resolved = await packageManager.resolve(async () => "skip");

	const projectConfigDir = path.join(cwd, CONFIG_DIR_NAME);
	const extensions = resolved.extensions
		.filter((entry) => entry.enabled)
		.map((entry) => ({
			name: getExtensionNameFromPath(entry.path),
			path: entry.path,
			source:
				entry.metadata.origin === "package"
					? normalizeDiscoverySource(
							entry.metadata.source,
							entry.metadata.scope === "project" ? projectConfigDir : agentDir,
						)
					: entry.metadata.source,
			scope: entry.metadata.scope,
			origin: entry.metadata.origin,
			baseDir: entry.metadata.baseDir,
		}));

	return {
		agentDir,
		globalSettingsPath: path.join(agentDir, "settings.json"),
		globalExtensionsDir: path.join(agentDir, "extensions"),
		projectConfigDir,
		projectSettingsPath: path.join(projectConfigDir, "settings.json"),
		projectExtensionsDir: path.join(projectConfigDir, "extensions"),
		piSource: discoverPiSource(),
		extensions,
	};
}
