## The template

`TEMPLATE_PATH` is a single self-contained HTML file:

- OS-respecting light/dark via `prefers-color-scheme` — Dawn colors from `pi/themes/rose-pine-dawn.json` in light mode and Moon colors from `pi/themes/rose-pine-moon.json` in dark mode.
- All CSS inlined. No external stylesheet, no build step.
- Vanilla JS for copy-to-clipboard on `<pre>` blocks (auto-attached on load).
- Monospace `<pre>` blocks wrap by default; add `.no-wrap` on `<pre>` when horizontal scrolling is preferred for fixed-width layouts.
- Mermaid (UMD build, `@11` tag = latest 11.x) is loaded from CDN **only if** the page contains a `<pre class="mermaid">` block, and uses page-aligned theme variables for its initial render.
- Graphviz (`@viz-js/viz`) is loaded only if the page contains a `<pre class="graphviz">` block; after render, default black/white output and opposite Rose Pine hard-coded colors are normalized to the active page palette for readable initial light/dark renders.
- Two placeholders to fill: `{{TITLE}}` (appears twice — `<title>` and `<h1>`) and `{{BODY}}`.

## Why an HTTP server (not `file://`)

Mermaid v10+ internally lazy-loads each diagram type as a separate ES module. Under `file://`, every file has a unique security origin and those cross-origin module fetches are blocked — Mermaid errors out and the diagram never renders. `RENDER_CMD` publishes completed HTML through a persistent Python document service on port `8765`, opens the localhost URL, and prints both local and LAN URLs. The service is detached into a new process session so command runners may clean up their own process group without terminating it.

`POST /api/documents/<id>` accepts requests from `127.0.0.1` only and atomically replaces the corresponding document. `GET /documents/<id>` is available on all interfaces; there is no directory listing or arbitrary filesystem access. `GET /api/health` identifies the service so the idempotent launcher can distinguish an existing rich-response service from an unrelated process occupying port `8765`. Rerendering the same title updates the same URLs.

Runtime state lives under `/tmp/rich-response-server`: published documents in `documents/`, the current PID in `server.pid`, and detached-process output in `server.log`. Stop the service with `kill "$(cat /tmp/rich-response-server/server.pid)"`; the next render starts it again.

## Outline (table of contents)

Auto-generated from `<h2>` and `<h3>` elements when the doc has 3+ headings. Sticky in the right gutter on screens wider than 1520px; hidden below that. Its `left` offset is half the body's `max-width` (`48.5ch`) plus a gutter, so `.outline` must keep the body font size — the 0.85em type sits on its children, otherwise `ch` shrinks and the nav lands on top of the content. Each heading gets an auto-slugged `id` so deep-links work. Nothing for the agent to do — just use `<h2>` and `<h3>` for sections; the template handles the rest.
