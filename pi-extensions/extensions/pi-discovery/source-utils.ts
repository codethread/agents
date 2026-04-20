import path from "node:path";
import { fileURLToPath } from "node:url";

export function getExtensionNameFromPath(filePath: string): string {
	const baseName = path.basename(filePath);
	if (baseName === "index.ts" || baseName === "index.js") {
		return path.basename(path.dirname(filePath));
	}
	return baseName.replace(/\.(ts|js)$/i, "");
}

export function expandHomePrefix(input: string): string {
	if (input === "~") return process.env.HOME ?? input;
	if (input.startsWith("~/")) {
		const home = process.env.HOME;
		if (!home) return input;
		return path.join(home, input.slice(2));
	}
	return input;
}

function isNonLocalPackageSource(source: string): boolean {
	return (
		source.startsWith("npm:") ||
		source.startsWith("git:") ||
		/^(https?|ssh|git):\/\//i.test(source) ||
		/^[^/\\]+@[^:]+:.+/.test(source) ||
		/^[a-z0-9.-]+\.[a-z]{2,}[/:].+/i.test(source)
	);
}

export function normalizeDiscoverySource(source: string, resolveBaseDir: string): string {
	if (isNonLocalPackageSource(source)) return source;
	return path.resolve(resolveBaseDir, expandHomePrefix(source));
}

export function pathFromModuleSpecifier(specifier: string): string {
	return specifier.startsWith("file://") ? fileURLToPath(specifier) : specifier;
}
