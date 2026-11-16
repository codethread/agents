# Rich response maintenance

## The template

`template.html` is the shared HTML document template:

- OS-respecting light/dark via `prefers-color-scheme` — Dawn colors from `pi/themes/rose-pine-dawn.json` in light mode and Moon colors from `pi/themes/rose-pine-moon.json` in dark mode.
- All CSS inlined. No external stylesheet, no build step.
- Syntax highlighting lazy-loads highlight.js when a `<pre><code class="language-…">` block is present; token colors use inline CSS variables mapped to the active Rose Pine Dawn/Moon palette.
- Vanilla JS adds copy icons to `<pre>` blocks. Mermaid and Graphviz source is captured before rendering so their icons copy the raw diagram text rather than generated SVG text.
- Monospace `<pre>` blocks wrap by default; add `.no-wrap` on `<pre>` when horizontal scrolling is preferred for fixed-width layouts.
- Mermaid (UMD build, `@11` tag = latest 11.x) is loaded from CDN **only if** the page contains a `<pre class="mermaid">` block, uses higher-contrast page-aligned theme variables, and renders in a compact viewport-width viewer. After Mermaid renders, the template lazy-loads pinned `svg-pan-zoom@3.6.2` to add zoom, fit, drag-to-pan, double-click, Ctrl/Cmd-scroll, and trackpad-pinch interactions. Plain wheel events continue to scroll the page outside fullscreen.
- Graphviz (`@viz-js/viz`) is loaded only if the page contains a `<pre class="graphviz">` block; after render, implicit text colors, default black/white output, default node fills/borders, and opposite Rose Pine hard-coded colors are normalized to the active page and diagram palettes for readable light/dark renders.
- Mermaid and Graphviz viewers have a fullscreen overlay. It locks base-document scrolling, stops pointer/wheel propagation at the overlay boundary, preserves each viewer's inline behavior, and closes by button or Escape.
- Two placeholders to fill: `{{TITLE}}` (appears twice — `<title>` and `<h1>`) and `{{BODY}}`.

## Why an HTTP server (not `file://`)

Mermaid v10+ internally lazy-loads each diagram type as a separate ES module. Under `file://`, every file has a unique security origin and those cross-origin module fetches are blocked — Mermaid errors out and the diagram never renders. `render.sh` publishes completed HTML through a persistent Python document service on port `8765`, opens the localhost URL, and prints local/LAN URLs and verified Tailscale document/bookmark URLs. The service is detached into a new process session so command runners may clean up their own process group without terminating it.

`POST /api/documents/<id>` accepts requests from `127.0.0.1` only and atomically replaces the corresponding document. `GET /documents/<id>` is available on all interfaces; `GET /` lists the 20 most recently published documents using the shared template. Questionnaire status is derived from answer-file presence; answer contents and arbitrary filesystem paths are never served. `GET /api/health` identifies the service so the idempotent launcher can distinguish an existing rich-response service from an unrelated process occupying port `8765`. Rerendering the same title updates the same URLs.

Runtime state lives under `/tmp/rich-response-server`: published documents in `documents/`, the current PID in `server.pid`, and detached-process output in `server.log`. Stop the service with `kill "$(cat /tmp/rich-response-server/server.pid)"`; the next render starts it again.

## Outline (table of contents)

Auto-generated from `<h2>` and `<h3>` elements when the doc has 3+ headings. Sticky in the right gutter on screens wider than 1520px; hidden below that. Its `left` offset is half the body's `max-width` (`48.5ch`) plus a gutter, so `.outline` must keep the body font size — the 0.85em type sits on its children, otherwise `ch` shrinks and the nav lands on top of the content. Each heading gets an auto-slugged `id` so deep-links work. Because diagrams break out beneath the fixed gutter, the outline dims only while its bounding box geometrically overlaps a diagram, then returns to full opacity on hover or keyboard focus. Nothing for the agent to do — just use `<h2>` and `<h3>` for sections; the template handles the rest.

## Questionnaires

`questionnaire.py render` validates the authored fragment with Python's standard-library HTML parser, derives trusted question/choice metadata, and adds `questionnaire.css` and `questionnaire.js` to the existing template. The receipt is JSON; answer files are plain Markdown. `questionnaire.py wait` polls inside the process and returns Markdown or a pending exit code.

Each render creates `/tmp/rich-response-server/questionnaires/<random-id>/`, containing its metadata/capability, rendered HTML, and eventually `answers.md`. The document ID includes that random identity. The server accepts `POST /api/answers/<id>/<capability>` from the LAN or Tailscale with JSON, validates answers against stored metadata, and links a completely written/fsynced temporary file into place. Exclusive linking prevents concurrent overwrites; identical retries succeed. Answer routes are redacted from request logs. Publication stays loopback-only and answers have no GET route.

Server protocol version 4 requires an explicit `server.py restart` when another version is running. Health, PID-file and process-command checks identify the owned process. The launcher binds before updating the PID file, so a losing startup cannot replace the active PID record. State survives restart.

Run `python3 -B -m unittest discover -s skillbox/harness/rich-response -p 'test_*.py' -v` from the repository root for focused parser/serializer, URL receipt and bookmark-page regressions; the Vitest wrapper also includes them in the normal suite. Verify transport and browser behavior with a synthetic questionnaire before sharing a fresh unanswered demo.

## Tailscale receipts

Publication reads the installed CLI's self identity, rejects blocked or unknown incoming-connection preferences from `tailscale get --json shields-up`, and probes `http://<Self.DNSName>:8765/api/health`, bypassing HTTP proxies. A matching service/version/PID is required before returning `tailscaleUrl` and `tailscaleHomeUrl`; otherwise both are null and `tailscaleUnavailableReason` explains the failure. Local/LAN publication remains available. Discovery is performed on each publication, so connection changes do not leave cached addresses in later receipts.

`localHomeUrl`, `lanHomeUrl` and `tailscaleHomeUrl` point to the service root. The index derives titles from published HTML and escapes them, orders by publication mtime, and shows answer status for known questionnaire identities. This intentionally makes recent published links discoverable to anyone who can reach the service. No Serve/Funnel commands are run: the existing all-interface IPv4 listener handles direct Tailscale access, preserving both other services and the loopback-only publishing boundary.
