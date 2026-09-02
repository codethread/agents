import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendInvocationRecord,
	invocationLogPath,
	redactArgs,
	redactEnvironment,
} from "./invocation-log.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("invocationLogPath", () => {
	it("uses the caller's state directory by default", () => {
		expect(invocationLogPath({ HOME: "/home/test" }, "/work")).toBe(
			"/home/test/.local/state/pies/invocations.jsonl",
		);
		expect(invocationLogPath({ XDG_STATE_HOME: "/state" }, "/work")).toBe(
			"/state/pies/invocations.jsonl",
		);
	});

	it("resolves an override relative to the caller's working directory", () => {
		expect(invocationLogPath({ PIES_LOG_FILE: "logs/pies.jsonl" }, "/work")).toBe(
			"/work/logs/pies.jsonl",
		);
	});
});

describe("log redaction", () => {
	it("retains only boolean and numeric environment values", () => {
		expect(
			redactEnvironment({
				SECRET: "hunter2",
				EMPTY: "",
				TRUE_VALUE: "true",
				FALSE_VALUE: "FALSE",
				INTEGER: "-42",
				DECIMAL: ".5",
				EXPONENT: "1.2e+3",
				NOT_A_NUMBER: "Infinity",
			}),
		).toEqual({
			SECRET: "[REDACTED]",
			EMPTY: "[REDACTED]",
			TRUE_VALUE: "true",
			FALSE_VALUE: "FALSE",
			INTEGER: "-42",
			DECIMAL: ".5",
			EXPONENT: "1.2e+3",
			NOT_A_NUMBER: "[REDACTED]",
		});
	});

	it("redacts API keys without hiding the remaining invocation arguments", () => {
		expect(
			redactArgs([
				"--api-key",
				"secret-one",
				"--model",
				"provider/model",
				"--api-key=secret-two",
				"ping",
			]),
		).toEqual([
			"--api-key",
			"[REDACTED]",
			"--model",
			"provider/model",
			"--api-key=[REDACTED]",
			"ping",
		]);
	});
});

describe("appendInvocationRecord", () => {
	it("appends complete JSONL records in request order with user-only permissions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pies-log-test-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "nested", "invocations.jsonl");
		await mkdir(join(directory, "nested"), { mode: 0o755 });

		await Promise.all([
			appendInvocationRecord(path, { event: "first", transcript: "π" }),
			appendInvocationRecord(path, { event: "second" }),
		]);

		const records = (await readFile(path, "utf8"))
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(records).toEqual([{ event: "first", transcript: "π" }, { event: "second" }]);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});
});
