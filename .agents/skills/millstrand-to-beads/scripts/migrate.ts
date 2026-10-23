#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { convert } from "./convert.ts";

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		workspace: { type: "string" },
		prefix: { type: "string" },
		owner: { type: "string" },
		output: { type: "string" },
		source: { type: "string" },
		help: { type: "boolean" },
	},
});
if (values.help) {
	console.log(`Usage:
  node migrate.ts capture --workspace agents --prefix agents --owner ct --output NEW_DIR
  node migrate.ts convert --source NEW_DIR/source.json --prefix agents --owner ct --output NEW_DIR_2

Capture reads all kanban cards, including closed cards, and their full subtrees.
Convert is offline and deterministic. Both refuse existing output directories.
Neither command writes to Beads or mutates Millstrand. Review report.json before import.`);
} else {
	const [command] = positionals;
	if (positionals.length !== 1 || !["capture", "convert"].includes(command))
		throw new Error("Choose capture or convert; see --help");
	const output = resolve(z.string().min(1).parse(values.output));
	const prefix = z.string().min(1).parse(values.prefix);
	const owner = z.string().min(1).parse(values.owner);
	let source: unknown;
	if (command === "convert") {
		source = JSON.parse(readFileSync(z.string().min(1).parse(values.source), "utf8"));
	} else {
		const workspace = z.string().min(1).parse(values.workspace);
		const strand = (...args: string[]) =>
			JSON.parse(
				execFileSync("strand", ["--workspace", workspace, ...args], {
					encoding: "utf8",
					maxBuffer: 64 * 1024 * 1024,
				}),
			);
		const boardSchema = z.object({ cards: z.array(z.object({ id: z.string() })) });
		const before = boardSchema.parse(strand("kanban", "board", "--all", "true"));
		const exports = before.cards.map(({ id }) => strand("kanban-export", id));
		const after = boardSchema.parse(strand("kanban", "board", "--all", "true"));
		const ids = (board: z.infer<typeof boardSchema>) =>
			board.cards
				.map((c) => c.id)
				.sort()
				.join(",");
		if (ids(before) !== ids(after))
			throw new Error("Board membership changed during capture; capture again");
		source = { workspace, exports };
	}
	const { issues, report } = convert(source, prefix, owner);
	mkdirSync(output); // No overwrite, including failed or previously reviewed captures.
	writeFileSync(resolve(output, "source.json"), JSON.stringify(source, null, 2) + "\n");
	writeFileSync(
		resolve(output, "issues.jsonl"),
		issues.map((i) => JSON.stringify(i)).join("\n") + "\n",
	);
	writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
	console.log(JSON.stringify({ output, ...report }, null, 2));
}
