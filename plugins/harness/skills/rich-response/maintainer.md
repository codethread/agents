## The template

`TEMPLATE_PATH` is a single self-contained HTML file:

- OS-respecting light/dark via `prefers-color-scheme` — Dawn colors from `pi/themes/rose-pine-dawn.json` in light mode and Moon colors from `pi/themes/rose-pine-moon.json` in dark mode.
- All CSS inlined. No external stylesheet, no build step.
- Vanilla JS for copy-to-clipboard on `<pre>` blocks (auto-attached on load).
- Monospace `<pre>` blocks wrap by default; add `.no-wrap` on `<pre>` when horizontal scrolling is preferred for fixed-width layouts.
- Mermaid (UMD build, `@11` tag = latest 11.x) is loaded from CDN **only if** the page contains a `<pre class="mermaid">` block.
- Two placeholders to fill: `{{TITLE}}` (appears twice — `<title>` and `<h1>`) and `{{BODY}}`.

## Why a localhost server (not `file://`)

Mermaid v10+ internally lazy-loads each diagram type as a separate ES module. Under `file://`, every file has a unique security origin and those cross-origin module fetches are blocked — Mermaid errors out and the diagram never renders. `RENDER_CMD` launches a short-lived (300s default) Python `http.server` bound to `127.0.0.1`, opens the page over `http://`, and self-terminates. The generated HTML file remains on disk after the server stops. The server uses a deterministic port for each output path, so rerendering the same title updates the same localhost URL while the server is alive; updates do not reopen the browser tab. Same fix applies to any future library that needs a real origin.

## Outline (table of contents)

Auto-generated from `<h2>` and `<h3>` elements when the doc has 3+ headings. Sticky in the right gutter on screens wider than 1280px; hidden below that. Each heading gets an auto-slugged `id` so deep-links work. Nothing for the agent to do — just use `<h2>` and `<h3>` for sections; the template handles the rest.
