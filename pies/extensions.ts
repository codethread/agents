const DAEMON_INCOMPATIBLE_EXTENSION_PATTERNS = ["/cli/print-mode-exit/", "/pi-nvim/"];

export interface ExtensionSettings {
	pies?: {
		excludeExtensions?: string[];
	};
}

export interface LoadedExtension {
	path: string;
}

export interface ExtensionCollection {
	extensions: LoadedExtension[];
}

function normalize(value: string): string {
	return value.trim().replaceAll("\\", "/");
}

export function parseExtensionExclusions(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(",").map(normalize).filter(Boolean);
}

export function extensionExclusionsFromSettings(settings: unknown, scope: string): string[] {
	const pies = (settings as ExtensionSettings | null | undefined)?.pies;
	if (pies === undefined) return [];
	if (pies === null || typeof pies !== "object" || Array.isArray(pies)) {
		throw new Error(`Invalid ${scope} Pi settings: "pies" must be an object`);
	}

	const exclusions = pies.excludeExtensions;
	if (exclusions === undefined) return [];
	if (
		!Array.isArray(exclusions) ||
		exclusions.some((value) => typeof value !== "string" || normalize(value).length === 0)
	) {
		throw new Error(
			`Invalid ${scope} Pi settings: "pies.excludeExtensions" must be an array of non-empty strings`,
		);
	}
	return exclusions.map(normalize);
}

export function filterDaemonIncompatibleExtensions<T extends ExtensionCollection>(
	base: T,
	configuredPatterns: string[] = [],
): T {
	const patterns = [
		...DAEMON_INCOMPATIBLE_EXTENSION_PATTERNS,
		...configuredPatterns.map(normalize).filter(Boolean),
	];
	return {
		...base,
		extensions: base.extensions.filter((extension) => {
			const path = normalize(extension.path);
			return !patterns.some((pattern) => path.includes(pattern));
		}),
	};
}
