import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	bindRequestContext,
	createRequestEnvironment,
	installProcessRouting,
	runInRequestContext,
	type RequestContext,
} from "./request-context.ts";

const DAEMON_SECRET = "MY_SECRET";
let restoreProcessRouting: () => void;

interface ProcessEventApi {
	emit(event: symbol): boolean;
	listenerCount(event: symbol): number;
	on(event: symbol, listener: () => void): unknown;
}

function context(env: NodeJS.ProcessEnv): RequestContext {
	return {
		cwd: "/request",
		env,
		argv: ["node", "pies"],
		write: () => true,
		requestExit: () => {},
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {
		throw new Error("Deferred promise resolver was not initialized");
	};
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

beforeAll(() => {
	process.env[DAEMON_SECRET] = "daemon-only";
	restoreProcessRouting = installProcessRouting();
});

afterAll(() => {
	restoreProcessRouting();
	delete process.env[DAEMON_SECRET];
});

describe("request-local process.env", () => {
	it("does not expose daemon-only environment variables to a request", async () => {
		const env = createRequestEnvironment({ CLIENT_VALUE: "client-only" }, "/tmp/pies.sock");

		await runInRequestContext(context(env), async () => {
			expect(process.env.MY_SECRET).toBeUndefined();
			expect(process.env.CLIENT_VALUE).toBe("client-only");
			expect(process.env.PI_CODING_AGENT).toBe("true");
			expect(process.env.PIES_SOCKET).toBe("/tmp/pies.sock");

			process.env.REQUEST_MUTATION = "request-only";
			await Promise.resolve();
			expect(process.env.REQUEST_MUTATION).toBe("request-only");
		});

		expect(process.env.MY_SECRET).toBe("daemon-only");
		expect(process.env.CLIENT_VALUE).toBeUndefined();
		expect(process.env.REQUEST_MUTATION).toBeUndefined();
	});

	it("decodes byte-oriented process output without corrupting it", async () => {
		const writes: Array<{ stream: string; data: string }> = [];
		await runInRequestContext(
			{
				...context({}),
				write: (stream, data) => {
					writes.push({ stream, data });
					return true;
				},
			},
			async () => {
				process.stdout.write(new Uint8Array([0xcf, 0x80]));
				process.stderr.write(new Uint8Array([0xe2, 0x9c, 0x93]));
			},
		);

		expect(writes).toEqual([
			{ stream: "stdout", data: "π" },
			{ stream: "stderr", data: "✓" },
		]);
	});

	it("keeps overlapping request environments isolated", async () => {
		let ready = 0;
		const bothReady = deferred();
		const barrier = deferred();
		const run = (value: string) =>
			runInRequestContext(context({ REQUEST_VALUE: value }), async () => {
				ready += 1;
				if (ready === 2) bothReady.resolve();
				await barrier.promise;
				await Promise.resolve();
				return process.env.REQUEST_VALUE;
			});

		const first = run("first");
		const second = run("second");
		await bothReady.promise;
		barrier.resolve();

		await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
	});

	it("runs event callbacks in their owning request context", async () => {
		const event = Symbol("pies-request-event");
		const events = process as unknown as ProcessEventApi;
		let observed: string | undefined;
		const ready = deferred();
		const barrier = deferred();
		const first = runInRequestContext(context({ REQUEST_VALUE: "first" }), async () => {
			events.on(event, () => {
				observed = process.env.REQUEST_VALUE;
			});
			ready.resolve();
			await barrier.promise;
		});

		await ready.promise;
		await runInRequestContext(context({ REQUEST_VALUE: "second" }), async () => {
			events.emit(event);
		});
		barrier.resolve();
		await first;

		expect(observed).toBe("first");
		expect(events.listenerCount(event)).toBe(0);
	});

	it("binds non-emitter callbacks to their owning request context", async () => {
		let bound!: () => string | undefined;
		const ready = deferred();
		const barrier = deferred();
		const first = runInRequestContext(context({ REQUEST_VALUE: "first" }), async () => {
			bound = bindRequestContext(() => process.env.REQUEST_VALUE);
			ready.resolve();
			await barrier.promise;
		});

		await ready.promise;
		const observed = await runInRequestContext(context({ REQUEST_VALUE: "second" }), async () =>
			bound(),
		);
		barrier.resolve();
		await first;

		expect(observed).toBe("first");
	});

	it("supports many concurrent scoped process listeners without retaining them", async () => {
		const event = Symbol("pies-concurrent-event");
		const events = process as unknown as ProcessEventApi;
		let readyCount = 0;
		const allReady = deferred();
		const barrier = deferred();
		const requests = Array.from({ length: 30 }, (_, index) =>
			runInRequestContext(context({ REQUEST_VALUE: String(index) }), async () => {
				events.on(event, () => {});
				readyCount += 1;
				if (readyCount === 30) allReady.resolve();
				await barrier.promise;
			}),
		);

		await allReady.promise;
		expect(process.getMaxListeners()).toBe(0);
		expect(events.listenerCount(event)).toBe(30);
		barrier.resolve();
		await Promise.all(requests);

		expect(events.listenerCount(event)).toBe(0);
	});
});
