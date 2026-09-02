import { describe, expect, it } from "vitest";
import { SessionLeaseRegistry } from "./session-leases.ts";

describe("SessionLeaseRegistry", () => {
	it("rejects a second owner without disturbing the active lease", () => {
		const leases = new SessionLeaseRegistry();
		leases.claim("session-1", "request-1");

		expect(() => leases.claim("session-1", "request-2")).toThrow(
			'Session "session-1" is already in use by another pies invocation',
		);
		leases.release("request-2");
		expect(() => leases.claim("session-1", "request-3")).toThrow("already in use");
		expect(leases.size).toBe(1);
	});

	it("releases a session for a later invocation", () => {
		const leases = new SessionLeaseRegistry();
		leases.claim("session-1", "request-1");
		leases.release("request-1");

		expect(() => leases.claim("session-1", "request-2")).not.toThrow();
		expect(leases.size).toBe(1);
	});

	it("atomically replaces an owner's lease during a session switch", () => {
		const leases = new SessionLeaseRegistry();
		leases.claim("session-1", "request-1");
		leases.claim("session-2", "request-2");

		expect(() => leases.claim("session-2", "request-1")).toThrow("already in use");
		expect(() => leases.claim("session-1", "request-3")).toThrow("already in use");

		leases.release("request-2");
		leases.claim("session-2", "request-1");
		expect(() => leases.claim("session-1", "request-3")).not.toThrow();
		expect(leases.size).toBe(2);
	});

	it("treats a repeated claim by the same owner as idempotent", () => {
		const leases = new SessionLeaseRegistry();
		leases.claim("session-1", "request-1");
		leases.claim("session-1", "request-1");

		expect(leases.size).toBe(1);
		leases.release("request-1");
		expect(leases.size).toBe(0);
	});
});
