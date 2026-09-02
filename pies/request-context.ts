import { AsyncLocalStorage } from "node:async_hooks";

export type RequestStream = "stdout" | "stderr";
export type RequestWrite = (stream: RequestStream, data: string) => boolean;
export type RequestExit = (code: number) => void;
export type RequestCallback = (...args: never[]) => unknown;

export interface RequestContext {
	cwd: string;
	env: NodeJS.ProcessEnv;
	argv: string[];
	write: RequestWrite;
	requestExit: RequestExit;
}

type ProcessEvent = string | symbol;
type ProcessListener = (...args: unknown[]) => unknown;
type ProcessEventMethod =
	| "on"
	| "addListener"
	| "once"
	| "prependListener"
	| "prependOnceListener"
	| "off"
	| "removeListener";
type NativeEventMethod = (event: ProcessEvent, listener: ProcessListener) => NodeJS.Process;

interface ScopedListener {
	event: ProcessEvent;
	listener: ProcessListener;
	wrapped: ProcessListener;
	removeListener: NativeEventMethod;
}

interface ScopedListenerOptions {
	nativeMethod: NativeEventMethod;
	once?: boolean;
	prepend?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();
const processListenerScopes = new WeakMap<RequestContext, Set<ScopedListener>>();
const activeProcessListenerScopes = new Set<Set<ScopedListener>>();
let installed = false;

function bindToContext<T extends RequestCallback>(context: RequestContext, callback: T): T {
	return function requestBoundCallback(this: unknown, ...args: never[]): unknown {
		return storage.run(context, () => Reflect.apply(callback, this, args));
	} as T;
}

function getProcessListenerScope(context: RequestContext): Set<ScopedListener> {
	let scope = processListenerScopes.get(context);
	if (!scope) {
		scope = new Set();
		processListenerScopes.set(context, scope);
	}
	activeProcessListenerScopes.add(scope);
	return scope;
}

function cleanupProcessListeners(context: RequestContext): void {
	const scope = processListenerScopes.get(context);
	if (!scope) return;
	for (const entry of scope) {
		Reflect.apply(entry.removeListener, process, [entry.event, entry.wrapped]);
	}
	scope.clear();
	activeProcessListenerScopes.delete(scope);
	processListenerScopes.delete(context);
}

export function runInRequestContext<T>(context: RequestContext, callback: () => T): T;
export function runInRequestContext<T>(
	context: RequestContext,
	callback: () => Promise<T>,
): Promise<T>;
export function runInRequestContext<T>(
	context: RequestContext,
	callback: () => T | Promise<T>,
): T | Promise<T> {
	try {
		const result = storage.run(context, callback);
		if (
			result !== null &&
			(typeof result === "object" || typeof result === "function") &&
			"then" in result &&
			typeof result.then === "function"
		) {
			return Promise.resolve(result).finally(() => cleanupProcessListeners(context)) as Promise<T>;
		}
		cleanupProcessListeners(context);
		return result;
	} catch (error) {
		cleanupProcessListeners(context);
		throw error;
	}
}

export function bindRequestContext<T extends RequestCallback>(callback: T): T {
	const context = storage.getStore();
	return context ? bindToContext(context, callback) : callback;
}

export function createRequestEnvironment(
	clientEnv: Record<string, string>,
	socketPath: string,
): NodeJS.ProcessEnv {
	return {
		...clientEnv,
		PI_CODING_AGENT: "true",
		AI_AGENT: "pi",
		PIES_DAEMON: "1",
		PIES_SOCKET: socketPath,
	};
}

function decodeWriteChunk(chunk: string | Uint8Array): string {
	return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
}

export function installProcessRouting(): () => void {
	if (installed) return () => {};
	installed = true;

	const originalCwd = process.cwd;
	const originalArgv = process.argv;
	const originalArgvDescriptor = Object.getOwnPropertyDescriptor(process, "argv");
	const originalEnvDescriptor = Object.getOwnPropertyDescriptor(process, "env");
	let daemonEnv = process.env;
	const originalExit = process.exit;
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;
	const processEventMethods: ProcessEventMethod[] = [
		"on",
		"addListener",
		"once",
		"prependListener",
		"prependOnceListener",
		"off",
		"removeListener",
	];
	const processObject = process as unknown as Record<ProcessEventMethod, NativeEventMethod>;
	const originalEventDescriptors = new Map(
		processEventMethods.map((name) => [name, Object.getOwnPropertyDescriptor(process, name)]),
	);
	const originalEventMethods = Object.fromEntries(
		processEventMethods.map((name) => [name, processObject[name]]),
	) as Record<ProcessEventMethod, NativeEventMethod>;
	const originalMaxListeners = process.getMaxListeners();

	const addScopedListener = (
		event: ProcessEvent,
		listener: ProcessListener,
		{ nativeMethod, once = false, prepend = false }: ScopedListenerOptions,
	): NodeJS.Process => {
		const context = storage.getStore();
		if (!context) return Reflect.apply(nativeMethod, process, [event, listener]);

		const scope = getProcessListenerScope(context);
		const bound = bindToContext(context, listener as RequestCallback) as ProcessListener;
		const wrapped: ProcessListener = function requestScopedProcessListener(
			this: unknown,
			...args: unknown[]
		): unknown {
			if (once) {
				scope.delete(entry);
				Reflect.apply(entry.removeListener, process, [event, wrapped]);
			}
			return Reflect.apply(bound, this, args);
		};
		Object.defineProperty(wrapped, "listener", { value: listener });
		const entry: ScopedListener = {
			event,
			listener,
			wrapped,
			removeListener: originalEventMethods.removeListener,
		};
		scope.add(entry);
		const addListener = prepend
			? originalEventMethods.prependListener
			: originalEventMethods.addListener;
		try {
			return Reflect.apply(addListener, process, [event, wrapped]);
		} catch (error) {
			scope.delete(entry);
			throw error;
		}
	};

	const removeScopedListener = (
		event: ProcessEvent,
		listener: ProcessListener,
		nativeMethod: NativeEventMethod,
	): NodeJS.Process => {
		const context = storage.getStore();
		const scope = context ? processListenerScopes.get(context) : undefined;
		const entry = scope
			? [...scope]
					.reverse()
					.find(
						(candidate) =>
							candidate.event === event &&
							(candidate.listener === listener || candidate.wrapped === listener),
					)
			: undefined;
		if (!scope || !entry) return Reflect.apply(nativeMethod, process, [event, listener]);
		scope.delete(entry);
		return Reflect.apply(entry.removeListener, process, [event, entry.wrapped]);
	};

	process.cwd = () => storage.getStore()?.cwd ?? originalCwd.call(process);
	Object.defineProperty(process, "argv", {
		configurable: true,
		enumerable: true,
		get: () => storage.getStore()?.argv ?? originalArgv,
	});
	Object.defineProperty(process, "env", {
		configurable: true,
		enumerable: true,
		get: () => storage.getStore()?.env ?? daemonEnv,
		set: (env: NodeJS.ProcessEnv) => {
			if (!env || typeof env !== "object" || Array.isArray(env)) {
				throw new TypeError("process.env must be assigned an object");
			}
			const context = storage.getStore();
			if (context) context.env = env;
			else daemonEnv = env;
		},
	});
	process.exit = ((code?: string | number | null): never => {
		const context = storage.getStore();
		if (!context) return originalExit.call(process, code);
		context.requestExit(typeof code === "number" ? code : 0);
		return undefined as never;
	}) as typeof process.exit;
	process.stdout.write = ((
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	): boolean => {
		const context = storage.getStore();
		if (!context)
			return originalStdoutWrite.call(process.stdout, chunk, encoding as BufferEncoding, callback);
		const accepted = context.write("stdout", decodeWriteChunk(chunk));
		const done = typeof encoding === "function" ? encoding : callback;
		done?.();
		return accepted;
	}) as typeof process.stdout.write;
	process.stderr.write = ((
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	): boolean => {
		const context = storage.getStore();
		if (!context)
			return originalStderrWrite.call(process.stderr, chunk, encoding as BufferEncoding, callback);
		const accepted = context.write("stderr", decodeWriteChunk(chunk));
		const done = typeof encoding === "function" ? encoding : callback;
		done?.();
		return accepted;
	}) as typeof process.stderr.write;
	processObject.on = (event, listener) =>
		addScopedListener(event, listener, { nativeMethod: originalEventMethods.on });
	processObject.addListener = (event, listener) =>
		addScopedListener(event, listener, { nativeMethod: originalEventMethods.addListener });
	processObject.once = (event, listener) =>
		addScopedListener(event, listener, { nativeMethod: originalEventMethods.once, once: true });
	processObject.prependListener = (event, listener) =>
		addScopedListener(event, listener, {
			nativeMethod: originalEventMethods.prependListener,
			prepend: true,
		});
	processObject.prependOnceListener = (event, listener) =>
		addScopedListener(event, listener, {
			nativeMethod: originalEventMethods.prependOnceListener,
			once: true,
			prepend: true,
		});
	processObject.off = (event, listener) =>
		removeScopedListener(event, listener, originalEventMethods.off);
	processObject.removeListener = (event, listener) =>
		removeScopedListener(event, listener, originalEventMethods.removeListener);

	process.setMaxListeners(0);

	return () => {
		for (const scope of activeProcessListenerScopes) {
			for (const entry of scope) {
				Reflect.apply(entry.removeListener, process, [entry.event, entry.wrapped]);
			}
			scope.clear();
		}
		activeProcessListenerScopes.clear();
		for (const name of processEventMethods) {
			const descriptor = originalEventDescriptors.get(name);
			if (descriptor) Object.defineProperty(process, name, descriptor);
			else delete processObject[name];
		}
		process.setMaxListeners(originalMaxListeners);
		process.cwd = originalCwd;
		if (originalArgvDescriptor) Object.defineProperty(process, "argv", originalArgvDescriptor);
		if (originalEnvDescriptor) {
			Object.defineProperty(process, "env", { ...originalEnvDescriptor, value: daemonEnv });
		}
		process.exit = originalExit;
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
		installed = false;
	};
}
