---
name: mermaid
description: >
  Pitfalls to avoid when writing Mermaid diagrams. Use whenever generating a
  `mermaid` code block, a `<pre class="mermaid">` block, or troubleshooting a
  Mermaid render error. Assumes you already know Mermaid syntax — this skill only
  covers the gotchas that silently break renders.
---

# mermaid

You already know Mermaid syntax. These are the things that break it.

## Pitfalls

- **Single spaces only.** Never align tokens with multiple spaces.
  `A -->|no|  B` fails. `A -->|no| B` works. The parser treats extra whitespace as a token.
- **Reserved words as node IDs.** Avoid `end`, `subgraph`, `direction`, `class`, `classDef`, `style`, `click`, `linkStyle` — case-insensitively in flowcharts. `End`, `END`, and `end` all collide with the `subgraph … end` keyword.
- **Punctuation in labels needs quotes.** `A[foo: bar?]` fails. `A["foo: bar?"]` works. Quote any label with `:`, `?`, `(`, `)`, `,`, `-`, or unicode.
- **Edge-label syntax.** Prefer `A -- text --> B` when the label is anything beyond a single word — it tokenises more reliably than `A -->|text| B`.
- **Indentation is fine** (2 spaces is conventional), but mixing tabs and spaces inside one diagram breaks the parser. Pick one.
- **`graph` vs `flowchart`** are aliases for the same diagram. Pick one and stick to it within a diagram.
- **Newlines matter.** Don't put two statements on one line without `;` between them: `A --> B; B --> C` works, `A --> B B --> C` doesn't.

## When rendering inside HTML

- Use `<pre class="mermaid">…</pre>`. Do **not** wrap the `<pre>` in `<code>` — that prevents Mermaid from finding it.
- Don't HTML-entity-encode the diagram body. `--&gt;` will render as text, not parse as an arrow. Write `-->` directly inside `<pre>`.
- Under `file://` origins, Mermaid v10+ fails because it lazy-loads diagram modules via dynamic import. Serve over `http://` (see `rich-response` skill).

## Debugging

When a render fails, the console error includes a line number and a caret (`^`) pointing at the offending position. The line number references the diagram source (not the HTML file). Read the caret position, not the expected-token list — the expected list is usually misleading.

## Diagram-type cheat (for reference)

| Type         | First line            |
| ------------ | --------------------- |
| Flowchart    | `flowchart TD` / `LR` |
| Sequence     | `sequenceDiagram`     |
| Class        | `classDiagram`        |
| State        | `stateDiagram-v2`     |
| ER           | `erDiagram`           |
| Gantt        | `gantt`               |
| Pie          | `pie title …`         |
| Mindmap      | `mindmap`             |
| Timeline     | `timeline`            |
| Quadrant     | `quadrantChart`       |
| User journey | `journey`             |
| Git graph    | `gitGraph`            |
