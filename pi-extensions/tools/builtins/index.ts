import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import registerBashTool from "./bash.js";
import registerEditTool from "./edit.js";
import registerReadTool from "./read.js";
import registerWriteTool from "./write.js";

export default function (pi: ExtensionAPI) {
	registerReadTool(pi);
	registerBashTool(pi);
	registerWriteTool(pi);
	registerEditTool(pi);
}
