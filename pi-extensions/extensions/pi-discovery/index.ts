import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPiDiscoveryExtension } from "./runtime.js";

export default function piDiscoveryExtension(pi: ExtensionAPI) {
	registerPiDiscoveryExtension(pi);
}
