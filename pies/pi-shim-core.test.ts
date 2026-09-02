import { describe, expect, it } from "vitest";
import { defaultRealPiCachePath, isPrintInvocation, selectRealPi } from "./pi-shim-core.ts";

describe("isPrintInvocation", () => {
	it.each([
		[["--print", "ping"], true],
		[["-p", "ping"], true],
		[["--model", "deepseek/deepseek-v4-flash", "ping"], false],
		[["--", "--print"], false],
		[["--system-prompt", "--print", "ping"], false],
	])("routes %j to print mode: %s", (args, expected) => {
		expect(isPrintInvocation(args)).toBe(expected);
	});
});

describe("selectRealPi", () => {
	it("skips every PATH entry that resolves back to the shim", async () => {
		const realpaths = new Map([
			["/package/pies/pi-shim.ts", "/package/pies/pi-shim.ts"],
			["/first/pi", "/package/pies/pi-shim.ts"],
			["/second/pi", "/opt/pi/bin/pi"],
		]);

		await expect(
			selectRealPi(["/first/pi", "/second/pi"], "/package/pies/pi-shim.ts", async (path) => {
				const resolved = realpaths.get(path);
				if (!resolved) throw new Error(`Unexpected path: ${path}`);
				return resolved;
			}),
		).resolves.toBe("/second/pi");
	});
});

describe("defaultRealPiCachePath", () => {
	it("honors the dedicated cache override without confusing it with the executable override", () => {
		expect(
			defaultRealPiCachePath({
				PIES_REAL_PI: "/opt/pi/bin/pi",
				PIES_REAL_PI_CACHE: "/tmp/pies-real-pi.json",
			}),
		).toBe("/tmp/pies-real-pi.json");
	});
});
