export class SessionLeaseRegistry {
	#ownersBySession = new Map<string, string>();
	#sessionsByOwner = new Map<string, string>();

	get size(): number {
		return this.#ownersBySession.size;
	}

	claim(sessionId: string, ownerId: string): void {
		const currentOwner = this.#ownersBySession.get(sessionId);
		if (currentOwner !== undefined && currentOwner !== ownerId) {
			throw new Error(`Session "${sessionId}" is already in use by another pies invocation`);
		}

		const previousSession = this.#sessionsByOwner.get(ownerId);
		if (previousSession === sessionId) return;

		this.#ownersBySession.set(sessionId, ownerId);
		if (previousSession !== undefined) this.#ownersBySession.delete(previousSession);
		this.#sessionsByOwner.set(ownerId, sessionId);
	}

	release(ownerId: string): void {
		const sessionId = this.#sessionsByOwner.get(ownerId);
		if (sessionId === undefined) return;
		if (this.#ownersBySession.get(sessionId) === ownerId) {
			this.#ownersBySession.delete(sessionId);
		}
		this.#sessionsByOwner.delete(ownerId);
	}
}
