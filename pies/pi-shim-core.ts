import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import which from "which";
import { parsePiArgs } from "./args.ts";

const CACHE_VERSION = 1;
type Environment = NodeJS.ProcessEnv;
type ResolveRealpath = (path: string) => Promise<string>;
type RealPiCache = { version: number; pathFingerprint: string; executable: string };

function pathFingerprint(pathValue: string): string {
	return createHash("sha256").update(pathValue).digest("hex");
}

function isRealPiCache(value: unknown): value is RealPiCache {
	if (!value || typeof value !== "object") return false;
	const cache = value as Record<string, unknown>;
	return (
		typeof cache.version === "number" &&
		typeof cache.pathFingerprint === "string" &&
		typeof cache.executable === "string"
	);
}

export function isPrintInvocation(args: string[]): boolean {
	return parsePiArgs(args).print === true;
}

export async function selectRealPi(
	candidates: readonly string[],
	shimPath: string,
	resolveRealpath: ResolveRealpath = (path) => realpath(path),
): Promise<string | undefined> {
	const shimRealpath = await resolveRealpath(shimPath);
	for (const candidate of candidates) {
		try {
			if ((await resolveRealpath(candidate)) !== shimRealpath) return candidate;
		} catch {
			// PATH entries can disappear between discovery and resolution.
		}
	}
	return undefined;
}

export function defaultRealPiCachePath(env: Environment = process.env): string {
	if (env.PIES_REAL_PI_CACHE) return env.PIES_REAL_PI_CACHE;
	const cacheHome = env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache");
	return join(cacheHome, "pies", "real-pi.json");
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

async function validCandidate(candidate: string, shimPath: string): Promise<string | undefined> {
	return (await isExecutable(candidate)) ? selectRealPi([candidate], shimPath) : undefined;
}

async function readCachedRealPi(
	cachePath: string,
	pathValue: string,
	shimPath: string,
): Promise<string | undefined> {
	try {
		const cached: unknown = JSON.parse(await readFile(cachePath, "utf8"));
		if (
			!isRealPiCache(cached) ||
			cached.version !== CACHE_VERSION ||
			cached.pathFingerprint !== pathFingerprint(pathValue)
		)
			return undefined;
		return validCandidate(cached.executable, shimPath);
	} catch {
		return undefined;
	}
}

async function writeRealPiCache(
	cachePath: string,
	pathValue: string,
	executable: string,
): Promise<void> {
	const temporaryPath = `${cachePath}.${process.pid}.tmp`;
	try {
		await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
		await writeFile(
			temporaryPath,
			`${JSON.stringify({ version: CACHE_VERSION, pathFingerprint: pathFingerprint(pathValue), executable })}\n`,
			{ mode: 0o600 },
		);
		await rename(temporaryPath, cachePath);
	} catch {
		await unlink(temporaryPath).catch(() => {});
	}
}

export async function resolveRealPi(
	shimPath: string,
	env: Environment = process.env,
): Promise<string> {
	if (env.PIES_REAL_PI) {
		const explicit = await validCandidate(env.PIES_REAL_PI, shimPath);
		if (explicit) return explicit;
		throw new Error(`PIES_REAL_PI is not an executable other than this shim: ${env.PIES_REAL_PI}`);
	}
	const pathValue = env.PATH || "";
	const cachePath = defaultRealPiCachePath(env);
	const cached = await readCachedRealPi(cachePath, pathValue, shimPath);
	if (cached) return cached;
	const matches = await which("pi", { all: true, nothrow: true, path: pathValue });
	const candidates: string[] = matches === null ? [] : Array.isArray(matches) ? matches : [matches];
	const executable = await selectRealPi(candidates, shimPath);
	if (!executable)
		throw new Error(
			"Could not find a real pi executable after excluding the pies shim; set PIES_REAL_PI=/absolute/path/to/pi",
		);
	await writeRealPiCache(cachePath, pathValue, executable);
	return executable;
}
