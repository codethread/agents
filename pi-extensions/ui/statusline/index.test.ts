import { describe, expect, it } from "vitest";
import { formatSessionLabel } from "./index.js";

describe("formatSessionLabel", () => {
	it("shows the session id next to the name", () => {
		expect(formatSessionLabel("review-flow", "session-123")).toBe("review-flow (session-123)");
	});

	it("falls back to the session id when no name exists", () => {
		expect(formatSessionLabel(undefined, "session-123")).toBe("session session-123");
	});

	it("sanitizes control characters before rendering", () => {
		expect(formatSessionLabel("review\nflow", "session\t123")).toBe("review flow (session 123)");
	});

	it("returns null when both fields are missing", () => {
		expect(formatSessionLabel(undefined, undefined)).toBeNull();
	});
});
