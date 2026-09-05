/** Latches an exit request while the runtime is still initializing. */
export class RequestCancellation {
	#exitCode: number | undefined;
	#abort: (() => void) | undefined;

	get requested(): boolean {
		return this.#exitCode !== undefined;
	}

	get exitCode(): number {
		return this.#exitCode ?? 0;
	}

	request(code: number): void {
		if (this.requested) return;
		this.#exitCode = code;
		this.#abort?.();
	}

	setAbort(handler: (() => void) | undefined): void {
		this.#abort = handler;
		if (this.requested) handler?.();
	}
}
