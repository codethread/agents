import { describe, expect, it } from "vitest";
import { layoutFlexTextItems } from "./flex-layout.js";

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function plain(lines: string[]) {
	return lines.map((line) => line.replaceAll(ansiPattern, ""));
}

describe("layoutFlexTextItems", () => {
	it("keeps each item on its own row when rows are available", () => {
		expect(layoutFlexTextItems(["first", "second", "third"], { width: 25, rows: 3 })).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	it("moves bottom items upward when rows are constrained", () => {
		expect(layoutFlexTextItems(["first", "second", "third"], { width: 25, rows: 2 })).toEqual([
			"first",
			"second              third",
		]);
	});

	it("uses single-space gaps before truncating", () => {
		expect(layoutFlexTextItems(["first", "second", "third"], { width: 18, rows: 1 })).toEqual([
			"first second third",
		]);
	});

	it("truncates with configurable ellipsis when width is constrained", () => {
		expect(
			plain(
				layoutFlexTextItems(["first", "second", "third"], { width: 13, rows: 1, ellipsis: "…" }),
			),
		).toEqual(["fir… sec… th…"]);
	});
});
