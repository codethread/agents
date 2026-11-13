import { parseArgs } from "node:util";
import {
	changelogHistorySchema,
	changelogQuerySchema,
	changelogSchema,
	queryChangelog,
	renderChangelog,
} from "@codethread/cli-changelog";
import historyDocument from "../changelog.json" with { type: "json" };
import manifest from "../package.json" with { type: "json" };

const history = changelogHistorySchema.parse(historyDocument);

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			since: { type: "string" },
			release: { type: "string" },
			limit: { type: "string" },
			offset: { type: "string" },
			json: { type: "boolean" },
			schema: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	});
	if (values.schema) {
		if (
			values.since !== undefined ||
			values.release !== undefined ||
			values.limit !== undefined ||
			values.offset !== undefined ||
			values.json
		) {
			throw new Error("Select --schema without query or output flags.");
		}
		process.stdout.write(`${JSON.stringify(changelogSchema(), null, 2)}\n`);
		return;
	}

	const query = changelogQuerySchema.parse({
		since: values.since,
		release: values.release,
		limit: values.limit,
		offset: values.offset,
	});
	const page = queryChangelog({ tool: manifest.name, version: manifest.version }, history, query);
	const output = values.json ? `${JSON.stringify(page, null, 2)}\n` : renderChangelog(page);
	process.stdout.write(output);
}

if (import.meta.main) {
	await main();
}
