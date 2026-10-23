import { z } from "zod";

const strandSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	title: z.string().min(1).max(500),
	state: z.enum(["active", "closed", "replaced"]),
	created_at: z.string(),
	updated_at: z.string(),
	attributes: z.record(z.string(), z.unknown()),
});
const edgeSchema = z.object({
	edge_type: z.enum(["parent-of", "depends-on"]),
	from_strand_id: z.string(),
	to_strand_id: z.string(),
});
export const snapshotSchema = z.object({
	workspace: z.string().min(1),
	exports: z.array(
		z.object({
			"root-id": z.string(),
			strands: z.array(strandSchema),
			"parent-of-edges": z.array(edgeSchema),
			"depends-on-edges": z.array(edgeSchema),
		}),
	),
});
type Strand = z.infer<typeof strandSchema>;
type Dependency = {
	issue_id: string;
	depends_on_id: string;
	type: "parent-child" | "blocks";
	created_at: string;
	created_by: string;
};

function text(node: Strand, key: string): string | undefined {
	const value = node.attributes[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") {
		throw new Error(`${node.id}: ${key} is not full text; use kanban-export, not lean list output`);
	}
	return value;
}

function timestamp(value: string): string {
	// Millstrand's SQLite timestamps are UTC, not the machine's local timezone.
	const iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
		? `${value.replace(" ", "T")}Z`
		: value;
	if (!/(?:Z|[+-]\d\d:\d\d)$/.test(iso) || Number.isNaN(Date.parse(iso))) {
		throw new Error(`Invalid timestamp: ${value}`);
	}
	return new Date(iso).toISOString();
}

function isWork(node: Strand): boolean {
	const a = node.attributes;
	return (
		a["kanban/card"] === "true" ||
		a["kanban/task"] === "true" ||
		a["kanban/type"] === "feature" ||
		a["kanban/type"] === "epic" ||
		a.kind === "task"
	);
}

function status(node: Strand): string {
	if (node.state !== "active") return "closed";
	switch (text(node, "kanban/lane")) {
		case undefined:
		case "pending":
		case "claimed": // Claims/processes are deliberately not transferred.
			return "open";
		case "refinement":
			return "draft";
		case "in_review":
		case "in_production":
			return "blocked";
		default:
			throw new Error(`${node.id}: unmapped lane ${text(node, "kanban/lane")}`);
	}
}

const contextKeys = [
	"source",
	"coordination/blocker",
	"coordination/decision",
	"coordination/parent-decision",
	"coordination/findings",
	"coordination/next-action",
	"coordination/handoff-note",
	"coordination/result",
	"coordination/wake-condition",
];

/** Pure, deterministic conversion. No tracker writes or live ownership transfer. */
export function convert(input: unknown, prefix: string, owner: string) {
	const snapshot = snapshotSchema.parse(input);
	z.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
		.parse(prefix);
	z.string().min(1).parse(owner);
	const nodes = new Map<string, Strand>();
	const edges = new Map<string, z.infer<typeof edgeSchema>>();
	for (const subtree of snapshot.exports) {
		if (!subtree.strands.some((s) => s.id === subtree["root-id"])) {
			throw new Error(`Missing export root ${subtree["root-id"]}`);
		}
		for (const node of subtree.strands) {
			const previous = nodes.get(node.id);
			if (previous && JSON.stringify(previous) !== JSON.stringify(node)) {
				throw new Error(`${node.id}: changed between subtree reads; capture again`);
			}
			nodes.set(node.id, node);
		}
		for (const edge of [...subtree["parent-of-edges"], ...subtree["depends-on-edges"]]) {
			edges.set(JSON.stringify(edge), edge);
		}
	}
	const work = new Map([...nodes].filter(([, node]) => isWork(node)));
	const parents = new Map<string, string>();
	const omittedEdges: z.infer<typeof edgeSchema>[] = [];
	for (const edge of edges.values()) {
		if (!work.has(edge.from_strand_id) || !work.has(edge.to_strand_id)) {
			omittedEdges.push(edge);
			continue;
		}
		if (edge.edge_type === "parent-of") {
			const previous = parents.get(edge.to_strand_id);
			if (previous && previous !== edge.from_strand_id) {
				throw new Error(`${edge.to_strand_id}: multiple parents require a mapping decision`);
			}
			parents.set(edge.to_strand_id, edge.from_strand_id);
		}
	}
	function priority(id: string, ancestors = new Set<string>()): number {
		if (ancestors.has(id)) throw new Error(`${id}: parent cycle`);
		ancestors.add(id);
		const parent = parents.get(id);
		// Traverse even when priority is explicit, so cycles never pass silently.
		const inherited = parent ? priority(parent, ancestors) : 3;
		const raw = text(work.get(id)!, "kanban/priority");
		if (raw === undefined) return inherited;
		if (!/^p[1-4]$/.test(raw)) throw new Error(`${id}: unmapped priority ${raw}`);
		return Number(raw.slice(1));
	}
	const beadId = (id: string) => `${prefix}-ms-${id}`;
	const issues = [...work.values()]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((node) => {
			const lane = text(node, "kanban/lane");
			const outcome = text(node, "kanban/outcome") ?? text(node, "outcome");
			const issueType = text(node, "kanban/type") ?? "task";
			if (!["feature", "epic", "task"].includes(issueType)) {
				throw new Error(`${node.id}: unmapped type ${issueType}`);
			}
			const updated = timestamp(node.updated_at);
			const mappedStatus = status(node);
			const notes = [
				`Imported from Millstrand ${snapshot.workspace}/${node.id}. Historical context, not renewed execution or publication authorization.`,
				`Original state: ${node.state}${lane ? `; lane: ${lane}` : ""}${outcome ? `; outcome: ${outcome}` : ""}.`,
				...contextKeys.flatMap((key) => {
					const value = text(node, key);
					return value ? [`${key}:\n${value}`] : [];
				}),
			];
			if (lane === "claimed" && node.state === "active")
				notes.push("Reopened unassigned: the legacy claim was not transferred.");
			if (lane === "in_review" && node.state === "active")
				notes.push(
					"Human review remains required; inspect the original card before resuming. No human assignment was invented.",
				);
			if (lane === "in_production" && node.state === "active")
				notes.push(
					"Release/production validation remains required; inspect the original card before resuming.",
				);
			const dependencies: Dependency[] = [];
			for (const edge of edges.values()) {
				if (!work.has(edge.from_strand_id) || !work.has(edge.to_strand_id)) continue;
				const parentEdge = edge.edge_type === "parent-of";
				const from = parentEdge ? edge.to_strand_id : edge.from_strand_id;
				const to = parentEdge ? edge.from_strand_id : edge.to_strand_id;
				if (from === node.id)
					dependencies.push({
						issue_id: beadId(from),
						depends_on_id: beadId(to),
						type: parentEdge ? "parent-child" : "blocks",
						created_at: updated,
						created_by: "millstrand-migration",
					});
			}
			const labels = [
				"migrated:millstrand",
				...Object.entries(node.attributes)
					.filter(
						([key, value]) =>
							key.startsWith("kanban.label/") && (value === true || value === "true"),
					)
					.map(([key]) => key.slice("kanban.label/".length)),
			];
			if (node.state === "active" && lane === "in_review") labels.push("needs-human-review");
			if (node.state === "active" && lane === "in_production")
				labels.push("needs-release-validation");
			return {
				id: beadId(node.id),
				title: node.title,
				...(text(node, "body") ? { description: text(node, "body") } : {}),
				notes: notes.join("\n\n"),
				status: mappedStatus,
				priority: priority(node.id),
				issue_type: issueType,
				owner,
				created_at: timestamp(node.created_at),
				updated_at: updated,
				...(mappedStatus === "closed"
					? { closed_at: updated, close_reason: outcome ?? `Millstrand state: ${node.state}` }
					: {}),
				external_ref: `millstrand:${snapshot.workspace}:${node.id}`,
				source_system: "millstrand",
				labels: [...new Set(labels)].sort(),
				dependencies: dependencies.sort((a, b) =>
					`${a.type}:${a.depends_on_id}`.localeCompare(`${b.type}:${b.depends_on_id}`),
				),
			};
		});
	return {
		issues,
		report: {
			workspace: snapshot.workspace,
			prefix,
			owner,
			cards: issues.filter((i) => i.issue_type !== "task").length,
			tasks: issues.filter((i) => i.issue_type === "task").length,
			statuses: Object.fromEntries(
				[...new Set(issues.map((i) => i.status))]
					.sort()
					.map((s) => [s, issues.filter((i) => i.status === s).length]),
			),
			parentLinks: issues.flatMap((i) => i.dependencies).filter((d) => d.type === "parent-child")
				.length,
			blockingLinks: issues.flatMap((i) => i.dependencies).filter((d) => d.type === "blocks")
				.length,
			omittedNodes: [...nodes.keys()].filter((id) => !work.has(id)).sort(),
			omittedEdges,
			ids: Object.fromEntries(issues.map((i) => [i.external_ref, i.id])),
			limitations: [
				"No comments, claims, sessions or executor state imported.",
				"kanban-export supplies internal dependencies only; cross-card/external prerequisites need separate review.",
				"closed_at uses the last source update; Millstrand exports no independent closure timestamp.",
			],
		},
	};
}
