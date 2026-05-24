---
name: rich-response
description: >
  Render a long-form or visually-structured response as a single self-contained HTML
  file and open it in the browser, instead of printing >50 lines to the terminal.
  Use when the response would benefit from diagrams (mermaid), wide tables, side-by-side
  comparisons, diffs, callouts, or collapsible detail. Triggers on phrases like
  "rich response", "open this in the browser", "render as HTML", "give me a doc",
  "diagram this", or whenever the response would otherwise exceed roughly 50 lines
  of terminal output.
---

# rich-response

## Variables

| Variable      | Value                                                                      | Notes                                                                     |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| RENDER_CMD    | `/Users/codethread/dev/projects/agents/skills/rich-response/render.sh`     | One-shot: substitute → validate → serve. Body on stdin, prints path.      |
| TEMPLATE_PATH | `/Users/codethread/dev/projects/agents/skills/rich-response/template.html` | Reference only — `RENDER_CMD` reads it. Read this to learn the primitives. |
| OUTPUT_DIR    | `/tmp`                                                                     | Where the rendered file lives                                             |

## When to use

- The response would print more than ~50 lines to the terminal.
- The content has structure that survives badly in monospace text:
  diagrams, wide tables, side-by-side comparisons, multi-section explainers, diffs.
- The user explicitly asks for HTML / a diagram / a "doc".

## When NOT to use

- Short answers, single-paragraph explanations, single code snippets.
- Anything the user is mid-iterating on in chat (don't break flow).
- Pure code edits — write the code, don't render a doc about the code.

## Knowledge

### The template

`TEMPLATE_PATH` is a single self-contained HTML file:

- OS-respecting light/dark via `prefers-color-scheme` — no JS toggle, no flash.
- All CSS inlined. No external stylesheet, no build step.
- Vanilla JS for copy-to-clipboard on `<pre>` blocks (auto-attached on load).
- Mermaid (UMD build, `@11` tag = latest 11.x) is loaded from CDN **only if** the page contains a `<pre class="mermaid">` block.
- Two placeholders to fill: `{{TITLE}}` (appears twice — `<title>` and `<h1>`) and `{{BODY}}`.

### Why a localhost server (not `file://`)

Mermaid v10+ internally lazy-loads each diagram type as a separate ES module. Under `file://`, every file has a unique security origin and those cross-origin module fetches are blocked — Mermaid errors out and the diagram never renders. `RENDER_CMD` launches a short-lived (300s default) Python `http.server` bound to `127.0.0.1`, opens the page over `http://`, and self-terminates. The generated HTML file remains on disk after the server stops. The server uses a deterministic port for each output path, so rerendering the same title updates the same localhost URL while the server is alive; updates do not reopen the browser tab. Same fix applies to any future library that needs a real origin.

### Available primitives

Write the body in plain semantic HTML. The template styles these:

- **Headings** `<h1>`–`<h4>`, `<p>`, `<ul>`/`<ol>`, `<a>`, `<hr>`, `<blockquote>`
- **Code** `<code>` inline; `<pre><code>…</code></pre>` block (copy button auto-added)
- **Tables** `<table><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>`
- **Collapsible** `<details><summary>Title</summary>…</details>`
- **Muted text** `<small>…</small>` or `<span class="muted">…</span>`
- **Badge** `<span class="badge">label</span>`

Utility classes added by the template:

| Class            | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `.callout`       | Info box (blue). Add `warn`, `error`, or `success`.    |
| `.callout-title` | Bold first line inside a callout.                      |
| `.grid-2`        | Two-column responsive grid; collapses on narrow.       |
| `.diff` on `<pre>` | Use `<span class="add">…</span>` / `<span class="del">…</span>` lines |
| `.mermaid` on `<pre>` | Renders content as a Mermaid diagram.              |
| `.tabs`          | Tab group. See **Tabs** below.                         |

### Tabs

CSS-only (no JS), up to 5 panels per group. Each group needs a unique `name` on the radio inputs. Structure: labels first, then panels, in matching order.

```html
<div class="tabs">
  <label class="tab"><input type="radio" name="api" checked>cURL</label>
  <label class="tab"><input type="radio" name="api">Node</label>
  <label class="tab"><input type="radio" name="api">Python</label>
  <div class="tab-panel"><pre><code class="language-bash">curl …</code></pre></div>
  <div class="tab-panel"><pre><code class="language-js">await fetch(…)</code></pre></div>
  <div class="tab-panel"><pre><code class="language-python">requests.get(…)</code></pre></div>
</div>
```

### Syntax highlighting

Opt-in. Add `class="language-xxx"` on the `<code>` element inside a `<pre>`. The template lazy-loads highlight.js + a GitHub light/dark theme only when at least one such block exists. Common values: `language-bash`, `language-js`, `language-ts`, `language-python`, `language-html`, `language-css`, `language-json`, `language-sql`, `language-yaml`, `language-rust`, `language-go`.

```html
<pre><code class="language-js">
const x = await fetch('/api')
</code></pre>
```

Plain `<pre><code>…</code></pre>` (no language class) stays unhighlighted — useful for terminal output or non-code text.

### Outline (table of contents)

Auto-generated from `<h2>` and `<h3>` elements when the doc has 3+ headings. Sticky in the right gutter on screens wider than 1280px; hidden below that. Each heading gets an auto-slugged `id` so deep-links work. Nothing for the agent to do — just use `<h2>` and `<h3>` for sections; the template handles the rest.

### Mermaid

Use `<pre class="mermaid">…</pre>`. Theme follows OS dark/light automatically. See the **mermaid** skill for syntax pitfalls — multi-space alignment, reserved IDs (`End`, `class`, etc.), label quoting. Don't HTML-entity-encode arrows inside the `<pre>` (`-->`, not `--&gt;`).

## Procedures

Single command. Body goes on stdin via a heredoc — agent never emits template boilerplate.

```bash
RENDER_CMD "<title>" <<'HTML'
<h2>Section heading</h2>
<p>Body content as semantic HTML using the primitives above.</p>
<div class="callout">Important point.</div>
<pre class="mermaid">
flowchart LR
  A --> B
</pre>
HTML
```

- Always use the **quoted** heredoc delimiter `<<'HTML'` (single quotes around `HTML`). Stops bash from expanding `$variables` or backticks inside the body.
- Title is HTML-escaped automatically; body is injected as-is (write semantic HTML).
- Output path is derived from the title (`/tmp/rich-<slug>.html`). Reusing the same title updates the same file. To override, pass it as the second arg: `RENDER_CMD "<title>" /tmp/custom.html <<'HTML' …`.
- `RENDER_CMD` runs validate.sh, then serve.sh, then prints the chosen output path on stdout. Validate/serve output goes to stderr.

After it returns: one-line chat reply pointing at the rendered file. No long recap — the doc IS the answer.

## Constraints

- Never edit `TEMPLATE_PATH`. `RENDER_CMD` reads it; if it needs updating that's a separate change.
- Never inline content that belongs in chat (a one-line answer goes in chat, not a 200-line HTML doc).
- Do not emit the template boilerplate (`<html>`, `<head>`, `<style>`, etc.) on stdin. Only the body fragment.
- Always use a quoted heredoc (`<<'HTML'`) — body must not be subject to bash expansion.
- Keep the body HTML semantic — use `<table>`, `<details>`, `<blockquote>`, etc. rather than `<div>` soup.

## Validation

- [ ] `RENDER_CMD` exited 0 and printed the output path on stdout.
- [ ] `serving http://localhost:…` line appeared on stderr.
- [ ] Chat response is short (≤5 lines) and references the rendered file.
