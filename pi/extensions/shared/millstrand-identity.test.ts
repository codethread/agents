import { describe, expect, it } from "vitest";
import { buildMillstrandChildEnvironment } from "./millstrand-identity.js";

describe("buildMillstrandChildEnvironment", () => {
	it("scrubs inherited ownership/bootstrap state and passes separate parent attribution", () => {
		const child = buildMillstrandChildEnvironment(
			{
				PATH: "/bin",
				MILLSTRAND_AGENT_ID: "legacy-parent",
				MILLSTRAND_RUN_ID: "run-1",
				MILLSTRAND_WORKSPACE: "/managed/world",
				MILLSTRAND_BOOTSTRAP_V1: "bootstrap-token",
				MILLSTRAND_BOOTSTRAP_ATTEMPT: "attempt-token",
				MILLSTRAND_RESERVATION_ID: "reservation-token",
				MILLSTRAND_IDENTITY_TRANSPORT: "native-v1",
			},
			{
				identity: "native-parent",
				instruction: "parent instruction",
				workspace: "/native/world",
			},
		);

		expect(child).toMatchObject({
			PATH: "/bin",
			PI_SUBAGENT: "1",
			MILLSTRAND_PI_PARENT_IDENTITY: "native-parent",
			MILLSTRAND_PI_WORKSPACE: "/native/world",
		});
		for (const name of [
			"MILLSTRAND_AGENT_ID",
			"MILLSTRAND_RUN_ID",
			"MILLSTRAND_WORKSPACE",
			"MILLSTRAND_BOOTSTRAP_V1",
			"MILLSTRAND_BOOTSTRAP_ATTEMPT",
			"MILLSTRAND_RESERVATION_ID",
			"MILLSTRAND_IDENTITY_TRANSPORT",
		]) {
			expect(child).not.toHaveProperty(name);
		}
	});

	it("attributes a child to a known legacy managed parent without giving it parent ownership", () => {
		const child = buildMillstrandChildEnvironment({
			MILLSTRAND_AGENT_ID: "legacy-parent",
			MILLSTRAND_RUN_ID: "legacy-run",
			MILLSTRAND_WORKSPACE: "/legacy/world",
		});

		expect(child.MILLSTRAND_PI_PARENT_IDENTITY).toBe("legacy-parent");
		expect(child.MILLSTRAND_PI_WORKSPACE).toBe("/legacy/world");
		expect(child.MILLSTRAND_AGENT_ID).toBeUndefined();
		expect(child.MILLSTRAND_RUN_ID).toBeUndefined();
		expect(child.MILLSTRAND_WORKSPACE).toBeUndefined();
	});

	it("does not turn a bare ambient identity into parent provenance", () => {
		const child = buildMillstrandChildEnvironment({
			MILLSTRAND_AGENT_ID: "ambient-not-managed",
		});

		expect(child.MILLSTRAND_PI_PARENT_IDENTITY).toBeUndefined();
		expect(child.MILLSTRAND_AGENT_ID).toBeUndefined();
	});
});
