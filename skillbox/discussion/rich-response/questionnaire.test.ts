import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

it("validates questionnaire, network receipt and bookmark-page contracts", () => {
	execFileSync("python3", ["-B", "-m", "unittest", "discover", "-p", "test_*.py", "-v"], {
		cwd: fileURLToPath(new URL(".", import.meta.url)),
		stdio: "pipe",
	});
});
