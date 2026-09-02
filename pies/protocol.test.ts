import { describe, expect, it } from "vitest";
import {
	encodeFrame,
	isProtocolMismatchFrame,
	LineDecoder,
	parseClientMessage,
	PROTOCOL_VERSION,
} from "./protocol.ts";

describe("LineDecoder", () => {
	it("reassembles split frames and returns multiple messages", () => {
		const decoder = new LineDecoder();
		const first = encodeFrame({ type: "stdout", data: "one" });
		const second = encodeFrame({ type: "result", exitCode: 0 });

		expect(decoder.push(Buffer.from(first.slice(0, 7)))).toEqual([]);
		expect(decoder.push(Buffer.from(first.slice(7) + second))).toEqual([
			{ type: "stdout", data: "one" },
			{ type: "result", exitCode: 0 },
		]);
	});

	it("preserves a multibyte character split across socket chunks", () => {
		const decoder = new LineDecoder();
		const frame = Buffer.from(encodeFrame({ type: "stdout", data: "pi π" }));
		const split = frame.indexOf(Buffer.from("π")) + 1;

		expect(decoder.push(frame.subarray(0, split))).toEqual([]);
		expect(decoder.push(frame.subarray(split))).toEqual([{ type: "stdout", data: "pi π" }]);
	});
});

describe("parseClientMessage", () => {
	it("accepts a valid run request", () => {
		const request = {
			protocol: PROTOCOL_VERSION,
			type: "run",
			id: "request-1",
			cwd: "/tmp/project",
			env: { PIES_TEST_VALUE: "one" },
			args: ["--print", "ping"],
		};

		expect(parseClientMessage(request)).toBe(request);
	});

	it("rejects non-string environment values at the protocol boundary", () => {
		expect(() =>
			parseClientMessage({
				protocol: PROTOCOL_VERSION,
				type: "run",
				id: "request-1",
				cwd: "/tmp/project",
				env: { PIES_TEST_VALUE: 1 },
				args: ["--print", "ping"],
			}),
		).toThrow("Run request env values must be strings");
	});

	it("rejects mismatched protocol versions", () => {
		expect(() => parseClientMessage({ protocol: 999, type: "status", id: "request-1" })).toThrow(
			"Unsupported protocol version",
		);
	});
});

describe("isProtocolMismatchFrame", () => {
	it("recognizes a protocol rejection even when an old daemon changed the request id", () => {
		expect(
			isProtocolMismatchFrame({
				type: "stderr",
				id: "server-generated-id",
				data: `Unsupported protocol version: ${PROTOCOL_VERSION}\n`,
			}),
		).toBe(true);
	});
});
