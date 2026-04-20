export {
	discoverPiExtensions,
	discoverPiSource,
	type PiExtensionDiscovery,
	type PiExtensionRecord,
	type PiInspectPackageDirSource,
	type PiSourceDiscovery,
} from "./discovery.js";
export {
	formatExtensionDiscoveryContextNote,
	formatExtensionDiscoveryForPrompt,
	formatExtensionDiscoveryReport,
} from "./rendering.js";
export { getExtensionNameFromPath } from "./source-utils.js";

const PI_TRIGGER_REGEX = /(^|[^\p{L}\p{N}_])Pi(?=$|[^\p{L}\p{N}_])/u;

export function hasStandalonePiTrigger(text: string): boolean {
	return PI_TRIGGER_REGEX.test(text);
}

export function appendContextNoteToText(text: string, contextNote: string): string {
	return `${text}\n\n${contextNote}`;
}
