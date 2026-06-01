#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const counterPath = resolve(dirname(fileURLToPath(import.meta.url)), ".hello_count");

function readCount(): number {
	try {
		const n = parseInt(readFileSync(counterPath, "utf8"), 10);
		return Number.isNaN(n) ? 0 : n;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
		throw err;
	}
}

const name = process.argv[2] ?? "World";
const count = readCount() + 1;
writeFileSync(counterPath, String(count), "utf8");
console.log(`Hello, ${name}!`);
console.log(`Greeted ${count} time(s).`);
