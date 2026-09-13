export const MILLSTRAND_PARENT_IDENTITY_ENV = "MILLSTRAND_PI_PARENT_IDENTITY";
export const MILLSTRAND_WORKSPACE_ENV = "MILLSTRAND_PI_WORKSPACE";

export type ActiveMillstrandIdentity = {
	identity: string;
	instruction: string;
	workspace?: string;
};

let activeIdentity: ActiveMillstrandIdentity | null = null;

export function setActiveMillstrandIdentity(identity: ActiveMillstrandIdentity | null): void {
	activeIdentity = identity;
}

export function getActiveMillstrandIdentity(): ActiveMillstrandIdentity | null {
	return activeIdentity;
}

function isBootstrapOwnershipKey(name: string): boolean {
	if (!name.startsWith("MILLSTRAND_")) return false;
	return (
		name === "MILLSTRAND_AGENT_ID" ||
		name === "MILLSTRAND_RUN_ID" ||
		name === "MILLSTRAND_RESERVATION_ID" ||
		name === "MILLSTRAND_BOOTSTRAP_V1" ||
		name === "MILLSTRAND_IDENTITY_TRANSPORT" ||
		name.startsWith("MILLSTRAND_BOOTSTRAP_") ||
		name.endsWith("_RESERVATION_ID") ||
		name.endsWith("_IDENTITY_TRANSPORT")
	);
}

/**
 * Build the environment for a native Pi child session.
 *
 * Parent ownership and managed bootstrap state are never inherited by the child.
 * The parent's resolved identity is carried only as provenance input for the
 * child's own `identity startup` call.
 */
export function buildMillstrandChildEnvironment(
	env: NodeJS.ProcessEnv,
	currentIdentity: ActiveMillstrandIdentity | null = activeIdentity,
): NodeJS.ProcessEnv {
	const childEnv = { ...env };
	const legacyManagedParent = env.MILLSTRAND_RUN_ID?.trim()
		? env.MILLSTRAND_AGENT_ID?.trim()
		: undefined;
	const parentIdentity = currentIdentity?.identity ?? legacyManagedParent;
	const workspace =
		currentIdentity?.workspace ??
		env[MILLSTRAND_WORKSPACE_ENV]?.trim() ??
		env.MILLSTRAND_WORKSPACE?.trim();

	for (const name of Object.keys(childEnv)) {
		if (isBootstrapOwnershipKey(name)) delete childEnv[name];
	}
	delete childEnv.MILLSTRAND_WORKSPACE;
	delete childEnv[MILLSTRAND_PARENT_IDENTITY_ENV];
	delete childEnv[MILLSTRAND_WORKSPACE_ENV];

	if (parentIdentity) childEnv[MILLSTRAND_PARENT_IDENTITY_ENV] = parentIdentity;
	if (workspace) childEnv[MILLSTRAND_WORKSPACE_ENV] = workspace;
	childEnv.PI_SUBAGENT = "1";
	return childEnv;
}
