import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { changelogHistorySchema, renderChangelogMarkdown } from "@codethread/cli-changelog";
import historyDocument from "../changelog.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };

const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);

export async function markdown(recordedHistory: unknown): Promise<string> {
	const path = fileURLToPath(changelogUrl);
	const config = await resolveConfig(path);
	if (config === null) throw new Error("Missing project Prettier configuration.");
	return format(
		renderChangelogMarkdown({
			title: manifest.name,
			history: changelogHistorySchema.parse(recordedHistory),
		}),
		{ ...config, filepath: path },
	);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			write: { type: "boolean" },
			check: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.write === values.check) {
		throw new Error("Select exactly one mode: --write or --check.");
	}

	const generated = await markdown(historyDocument);
	if (values.check) {
		if ((await Bun.file(changelogUrl).text()) !== generated) {
			throw new Error("CHANGELOG.md is stale; run pnpm changelog:generate.");
		}
		return;
	}
	await Bun.write(changelogUrl, generated);
}

if (import.meta.main) {
	await main();
}
