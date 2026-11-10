---
name: rich-response
description: >
  Render responses as HTML and open them in the browser when requested, when they
  exceed roughly 50 lines, or when diagrams, tables or comparisons improve readability.
  Use live questionnaires only when the user explicitly requests a questionnaire or alignment check.
---

# rich-response

## Choose the flow

For a static rich document, follow the procedure below, publish it, and continue the conversation. Only on an explicit user request for a questionnaire or alignment check, read [Live questionnaires](questionnaires.md) and wait for the user’s Markdown answer file.

## When to use

- The response would print more than ~50 lines to the terminal.
- The content has structure that survives badly in monospace text:
  diagrams, wide tables, side-by-side comparisons, multi-section explainers, diffs.
- The user explicitly asks for HTML / a diagram / a "doc".

## When NOT to use

- Short answers, single-paragraph explanations, single code snippets.
- Ongoing chat iteration without an explicit questionnaire or alignment-check request.
- Pure code edits — write the code, don't render a doc about the code.

## Procedures

In the commands below, replace `RENDER_CMD` with the absolute path to this skill's `render.sh`.

Write a semantic HTML body fragment to a temporary source file, then pipe it into the renderer. Use elements such as `<table>`, `<details>` and `<blockquote>` for structure. The authoring reference below covers the available primitives; the renderer reads `template.html` unchanged and supplies the document wrapper and styling.

Use a quoted heredoc (`<<'HTML'`) so the shell preserves `$variables` and backticks literally.

```bash
cat > /tmp/rich-response-body.html <<'HTML'
<h2>Section heading</h2>
<p>Body content as semantic HTML using the primitives below.</p>
<div class="callout">Important point.</div>
HTML

RENDER_CMD "<title>" < /tmp/rich-response-body.html
```

For updates, edit `/tmp/rich-response-body.html`, then rerun only:

```bash
RENDER_CMD "<title>" < /tmp/rich-response-body.html
```

- Title is HTML-escaped automatically; body is injected as-is.
- Output path is derived from the title (`/tmp/rich-<slug>.html`). Reusing the same title updates the same rendered file and URLs. To override, pass it as the second arg: `RENDER_CMD "<title>" /tmp/custom.html < /tmp/rich-response-body.html`.
- The renderer validates and publishes the document, then prints its output path on stdout. Validation and publication messages go to stderr.
- Published documents are readable on the local network and, when verified, Tailscale. Use a trusted LAN or tailnet.

After it returns, present every reported document URL as a clickable link, copy these exact URLs from the output. If Tailscale is unavailable, report the reason alongside the local/LAN links. Keep the reply short — the doc IS the answer.

## Authoring reference

### Available primitives

The template styles these elements:

- **Headings** `<h1>`–`<h4>`, `<p>`, `<ul>`/`<ol>`, `<a>`, `<hr>`, `<blockquote>`
- **Code** `<code>` inline; `<pre><code>…</code></pre>` block (copy button auto-added)
- **Tables** `<table><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>`
- **Collapsible** `<details><summary>Title</summary>…</details>`
- **Muted text** `<small>…</small>` or `<span class="muted">…</span>`
- **Badge** `<span class="badge">label</span>`

Utility classes added by the template:

| Class                  | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `.callout`             | Info box (blue). Add `warn`, `error`, or `success`.                      |
| `.callout-title`       | Bold callout lead-in; it adds a gap before following inline text.        |
| `.grid-2`              | Two-column responsive grid; collapses on narrow.                         |
| `.diff` on `<pre>`     | Use `<span class="add">…</span>` / `<span class="del">…</span>` lines    |
| `.no-wrap` on `<pre>`  | Switch default wrapping to horizontal scrolling for fixed-width layouts. |
| `.mermaid` on `<pre>`  | Renders content as a Mermaid diagram.                                    |
| `.graphviz` on `<pre>` | Renders DOT content as a Graphviz SVG diagram.                           |
| `.tabs`                | Tab group. See **Tabs** below.                                           |

### Tabs

CSS-only (no JS), up to 5 panels per group. Each group needs a unique `name` on the radio inputs. Structure: labels first, then panels, in matching order.

```html
<div class="tabs">
	<label class="tab"><input type="radio" name="api" checked />cURL</label>
	<label class="tab"><input type="radio" name="api" />Node</label>
	<label class="tab"><input type="radio" name="api" />Python</label>
	<div class="tab-panel">
		<pre><code class="language-bash">curl …</code></pre>
	</div>
	<div class="tab-panel">
		<pre><code class="language-js">await fetch(…)</code></pre>
	</div>
	<div class="tab-panel">
		<pre><code class="language-python">requests.get(…)</code></pre>
	</div>
</div>
```

### Syntax highlighting

Add `class="language-xxx"` on the `<code>` element inside a `<pre>` to enable syntax highlighting. Common values: `language-bash`, `language-js`, `language-ts`, `language-python`, `language-html`, `language-css`, `language-json`, `language-sql`, `language-yaml`, `language-rust`, `language-go`, `language-clojure` (also `language-clj` and `language-edn`).

```html
<pre><code class="language-js">
const x = await fetch('/api')
</code></pre>
```

Plain `<pre><code>…</code></pre>` stays unhighlighted — useful for terminal output or non-code text.

### Mermaid

Use `<pre class="mermaid">…</pre>` with raw Mermaid source (`-->`, not `--&gt;`). The template supplies diagram sizing, theming and viewer controls; use the `<pre>` directly without custom wrappers or sizing classes. Load the **mermaid** skill before writing Mermaid for its syntax pitfalls.

### Graphviz

Use `<pre class="graphviz">…</pre>` with raw DOT source (`->`, not `-&gt;`). The template renders it in the browser; no local `dot` installation is needed.

```html
<pre class="graphviz">
digraph G {
  rankdir=LR;
  node [shape=box, style="rounded,filled", fillcolor="#f4ede8"];
  Start -> Validate -> Render -> Serve;
}
</pre>
```

Use a local `dot -Tsvg` step only when browser rendering is unsuitable, such as strict offline use or an unsupported Graphviz feature. Prefer the template's automatic palette; author explicit colors only when they carry meaning.

## Maintenance

For changes to the template or rendering runtime, read [Maintainer reference](maintainer.md).
