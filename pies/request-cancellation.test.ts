import { describe, expect, it, vi } from "vitest";
import { RequestCancellation } from "./request-cancellation.ts";

describe("request cancellation", () => {
	it("preserves cancellation before the runtime can register its abort handler", () => {
		const cancellation = new RequestCancellation();
		cancellation.request(130);
		const abort = vi.fn();
		cancellation.setAbort(abort);
		expect(abort).toHaveBeenCalledOnce();
		expect(cancellation.requested).toBe(true);
		expect(cancellation.exitCode).toBe(130);
	});

	it("aborts once and preserves the first exit reason when cancellation repeats", () => {
		const cancellation = new RequestCancellation();
		const abort = vi.fn();
		cancellation.setAbort(abort);
		cancellation.request(130);
		cancellation.request(0);
		expect(abort).toHaveBeenCalledOnce();
		expect(cancellation.exitCode).toBe(130);
		cancellation.setAbort(undefined);
		expect(cancellation.requested).toBe(true);
	});
});
