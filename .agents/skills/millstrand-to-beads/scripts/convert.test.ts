import { describe, expect, it } from "vitest";
import { convert } from "./convert.ts";

function node(id: string, attributes: Record<string, unknown> = {}, state = "active") {
	return {
		id,
		title: id,
		state,
		created_at: "2026-09-24 13:11:04",
		updated_at: "2026-09-25 15:41:15",
		attributes: { kind: "task", ...attributes },
	};
}
function edge(from: string, to: string, type = "parent-of") {
	return { from_strand_id: from, to_strand_id: to, edge_type: type };
}
function snapshot(
	strands = [node("root")],
	parents: ReturnType<typeof edge>[] = [],
	deps: ReturnType<typeof edge>[] = [],
) {
	return {
		workspace: "agents",
		exports: [
			{ "root-id": strands[0].id, strands, "parent-of-edges": parents, "depends-on-edges": deps },
		],
	};
}

describe("Millstrand conversion", () => {
	it("preserves full prose and reverses nesting, not prerequisites", () => {
		const body = "# Why\n\nKeep the exact text.\n";
		const input = snapshot(
			[
				node("root", { "kanban/type": "epic", "kanban/priority": "p1", body }),
				node("feature", { "kanban/type": "feature" }),
				node("task"),
				node("prereq"),
			],
			[edge("root", "feature"), edge("feature", "task")],
			[edge("task", "prereq", "depends-on")],
		);
		const result = convert(input, "agents", "ct");
		const task = result.issues.find((i) => i.id === "agents-ms-task")!;
		expect(task.priority).toBe(1);
		expect(task.dependencies.map((d) => [d.depends_on_id, d.type])).toEqual([
			["agents-ms-prereq", "blocks"],
			["agents-ms-feature", "parent-child"],
		]);
		expect(result.issues.find((i) => i.id === "agents-ms-root")?.description).toBe(body);
		expect(task.created_at).toBe("2026-09-24T13:11:04.000Z");
		expect(task.external_ref).toBe("millstrand:agents:task");
		expect(convert(input, "agents", "ct")).toEqual(result);
	});

	it.each([
		["active", "pending", "open"],
		["active", "claimed", "open"],
		["active", "refinement", "draft"],
		["active", "in_review", "blocked"],
		["active", "in_production", "blocked"],
		["closed", "claimed", "closed"],
		["replaced", "pending", "closed"],
	])("maps %s/%s to %s without transferring a claim", (state, lane, status) => {
		const {
			issues: [issue],
		} = convert(
			snapshot([node("root", { "kanban/lane": lane, "kanban/owner": "legacy-agent" }, state)]),
			"agents",
			"ct",
		);
		expect(issue.status).toBe(status);
		expect(issue).not.toHaveProperty("assignee");
		expect(issue.owner).toBe("ct");
		if (state !== "active") expect(issue.close_reason).toBe(`Millstrand state: ${state}`);
	});

	it("retains outcome and selected decision context, but not agent/runtime records", () => {
		const input = snapshot(
			[
				node(
					"root",
					{
						"kanban/outcome": "abandoned",
						"coordination/parent-decision": "Do not deploy",
						"kanban.label/operations": "true",
					},
					"closed",
				),
				node("session", { kind: "agent", "harness/session-id": "not-a-task" }),
			],
			[edge("root", "session")],
		);
		const result = convert(input, "agents", "ct");
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].close_reason).toBe("abandoned");
		expect(result.issues[0].notes).toContain("Do not deploy");
		expect(result.issues[0].labels).toContain("operations");
		expect(result.report.omittedNodes).toEqual(["session"]);
		expect(result.report.omittedEdges).toHaveLength(1);
	});

	it("deduplicates overlapping identical exports and rejects changing source", () => {
		const input = snapshot();
		input.exports.push(structuredClone(input.exports[0]));
		expect(convert(input, "agents", "ct").issues).toHaveLength(1);
		input.exports[1].strands[0].title = "Changed";
		expect(() => convert(input, "agents", "ct")).toThrow("changed between subtree reads");
	});

	it("omits absent or empty descriptions for exact native reconciliation", () => {
		for (const attributes of [{}, { body: "" }]) {
			expect(
				convert(snapshot([node("root", attributes)]), "agents", "ct").issues[0],
			).not.toHaveProperty("description");
		}
	});

	it("rejects lean omitted bodies rather than silently losing descriptions", () => {
		expect(() =>
			convert(
				snapshot([node("root", { body: { "millstrand/omitted": true, bytes: 1201 } })]),
				"agents",
				"ct",
			),
		).toThrow("not full text");
	});

	it("rejects unmapped lanes, priorities and ambiguous hierarchies", () => {
		expect(() =>
			convert(snapshot([node("root", { "kanban/lane": "unexpected" })]), "agents", "ct"),
		).toThrow("unmapped lane");
		expect(() =>
			convert(snapshot([node("root", { "kanban/priority": "p9" })]), "agents", "ct"),
		).toThrow("unmapped priority");
		const nodes = [node("root"), node("other"), node("task")];
		expect(() =>
			convert(snapshot(nodes, [edge("root", "task"), edge("other", "task")]), "agents", "ct"),
		).toThrow("multiple parents");
		expect(() =>
			convert(snapshot(nodes, [edge("root", "task"), edge("task", "root")]), "agents", "ct"),
		).toThrow("parent cycle");
	});
});
