import { describe, expect, it } from "vitest";
import { formatDelay, formatScheduledTimestamp, parseDelayArgs } from "./index.js";

describe("parseDelayArgs", () => {
	it("parses compact duration strings and preserves the prompt", () => {
		expect(parseDelayArgs("5m continue when the upgrade is probably done")).toEqual({
			delayMs: 5 * 60 * 1000,
			prompt: "continue when the upgrade is probably done",
		});
	});

	it("supports seconds, hours, and days", () => {
		expect(parseDelayArgs("1s ping").delayMs).toBe(1000);
		expect(parseDelayArgs("2h ping").delayMs).toBe(2 * 60 * 60 * 1000);
		expect(parseDelayArgs("1d ping").delayMs).toBe(24 * 60 * 60 * 1000);
	});

	it("requires both a duration and prompt", () => {
		expect(() => parseDelayArgs("5m")).toThrow("usage");
	});

	it("rejects invalid durations", () => {
		expect(() => parseDelayArgs("soon continue")).toThrow("invalid delay");
	});
});

describe("formatDelay", () => {
	it("formats delays for notification text", () => {
		expect(formatDelay(2 * 60 * 60 * 1000)).toBe("2 hours");
	});
});

describe("formatScheduledTimestamp", () => {
	it("formats same-day times as hh:mm:ss", () => {
		expect(
			formatScheduledTimestamp(new Date(2026, 5, 27, 14, 3, 9), new Date(2026, 5, 27, 12, 0, 0)),
		).toBe("[14:03:09]");
	});

	it("formats later-day times as mm:dd:hh:mm", () => {
		expect(
			formatScheduledTimestamp(new Date(2026, 6, 1, 2, 3, 9), new Date(2026, 5, 30, 12, 0, 0)),
		).toBe("[07:01:02:03]");
	});
});
