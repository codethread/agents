import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerBashTool from "./bash.js";
import registerReadTool from "./read.js";

export default function (pi: ExtensionAPI) {
	registerReadTool(pi);
	registerBashTool(pi);
}
