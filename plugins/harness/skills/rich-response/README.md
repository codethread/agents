# Rich response

Have an agent create its response in HTML rather than Markdown, allowing a richer view for complex discussions.

Supports:

- Mermaid with higher-contrast page-aligned light/dark theming, compact full-width viewers, isolated fullscreen overlays, zoom/pan controls, and raw-source copying
- Graphviz with compact full-width viewers, isolated fullscreen overlays, active-palette normalization, and raw-source copying
- Basic styling, including callouts with spaced title lead-ins
- Tabs
- Code snippets and diffs
- Local, LAN and detected Tailscale links, with a stable bookmark for recent documents
- Live questionnaires with deliberate choices, optional notes and atomic Markdown answer files

## Live questionnaires

Ask for a “questionnaire” or “alignment check” to have your agent investigate a problem and turn it into a few clear decisions you can answer in your browser or on your phone. Questionnaires are opt-in; ordinary conversation and static documents remain the defaults. Each recommendation includes a brief reason and its main tradeoff, and starts unselected. Tap your choices and **Submit answers**; the active agent reads the saved Markdown and acknowledges receipt before considering the answers and responding.

The author writes ordinary semantic HTML. The bundled runtime supplies form styling, validation, submission and a wait command. It supports single choice, multiple choice and free text without agent-specific tools, callbacks or additional packages.

Shared light/dark palettes keep secondary text, including blockquotes and recommendation badges, above 4.5:1 contrast on page and inset backgrounds. Textarea boundaries use a separate control color above 3:1; decorative borders stay subtle. Questionnaires retain native controls, associated labels, visible keyboard focus and a live submission status. Palette regression tests protect these contrast thresholds; they are not a complete accessibility audit.

```sh
python3 questionnaire.py render "Workshop" < /tmp/workshop-body.html
python3 questionnaire.py wait /tmp/rich-response-server/questionnaires/<id>/answers.md --timeout 60
```

Run these commands from this directory, or use absolute script paths. Render prints a JSON receipt with the local/LAN/Tailscale document URLs, stable bookmark URLs, rendered HTML path, unique answer path and exact wait command. `tailscaleUrl` and `tailscaleHomeUrl` are null when unavailable; `tailscaleUnavailableReason` explains why. `--no-open` leaves the browser closed. Every render creates a new questionnaire, including when its title is reused.

Wait prints completed Markdown and exits 0, or prints `pending` to stderr and exits 2 at the timeout (60 seconds by default). Run it again on the same answer path to continue waiting. A timeout never implies agreement. The agent must stay active during this interaction.

Submission saves the question wording, choice labels and optional notes atomically. Browser success means the file was saved. The first submission is final: identical retries are accepted, and differing retries cannot overwrite it. Ask for a fresh questionnaire to revise answers. The server records decisions; it does not execute actions.

Questionnaires use the same local/LAN/Tailscale service. Anyone able to reach it can find recent questionnaire links on the bookmark page and submit unanswered forms. Use it on a trusted LAN or tailnet; it has no application login or answer-download endpoint. Files are temporary and persist until local cleanup or reboot.

If an older server is running, publication reports a version mismatch. Run `python3 server.py restart` from this directory. Restart verifies the health identity, PID file and process command before stopping the service; it preserves all documents and answers and refuses unrelated listeners.

## Tailscale access and a stable bookmark

The service uses its existing fixed port `8765` directly on the Tailscale interface. It reads `tailscale status --json --peers=false`, checks `tailscale get --json shields-up`, and probes its reported MagicDNS address before returning a link. If incoming connections are blocked, it reports Tailscale as unavailable even when a local probe could succeed. It does not configure Tailscale Serve, Funnel, login, DNS or access rules, so other applications keep their existing routes and ports.

Every publication reports the exact Tailscale document URL and a stable bookmark URL ending in `:8765/`. The bookmark shows the 20 most recent documents, newest first, with questionnaires marked **Awaiting answers** or **Answers submitted**. Refresh it for new publications. Individual questionnaire URLs still refer to one submission; bookmark the service root to find later questionnaires.

For example, a receipt contains:

```json
{
	"tailscaleUrl": "http://<reported-machine-name>:8765/documents/<document-id>",
	"tailscaleHomeUrl": "http://<reported-machine-name>:8765/",
	"tailscaleUnavailableReason": null
}
```

Use the actual returned URLs. Tailscale assigns the machine's [MagicDNS name](https://tailscale.com/docs/features/magicdns); renaming or replacing that machine changes its address. The service stays available while the host is awake and the server is running. Both devices need Tailscale connectivity, and existing tailnet rules must allow port `8765`. A local health probe uses this host’s own route and cannot prove inbound access from another device. The host’s **Allow incoming connections** setting must be enabled; the publisher reports a blocked setting without changing it. Test the link on your phone with Wi-Fi off to verify remote access.

HTTP is carried through Tailscale for tailnet connections; direct LAN access remains plain HTTP. When Tailscale is unavailable, publication preserves local/LAN access and reports the reason instead of advertising an unverified link. No Tailscale installation is required for local/LAN use.

## Persistent local and LAN URLs

Rendering publishes the completed HTML to an idempotent document server on fixed port `8765`. The first render starts the server in a detached process; later renders reuse it. Publishing the same document replaces it atomically while keeping its URLs stable.

The publishing API accepts writes from localhost only. Documents are readable locally and over the LAN. The agent receives local and LAN URLs, plus the verified Tailscale URL when available, and presents them so the user can choose:

- `http://localhost:8765/documents/<id>` — open on the computer running the agent
- `http://<LAN-IP>:8765/documents/<id>` — open from another device on the same LAN

The localhost URL opens automatically. The agent shows local/LAN links and all reported Tailscale links. LAN access remains available while the server is running and may require allowing incoming Python connections through the host firewall. The bookmark page exposes titles and links to recent published documents, with no arbitrary filesystem browsing. Use this shared index only on a trusted network.

![](https://github.com/user-attachments/assets/25cd1d52-e0fa-47a0-8ce8-a8a50ccdaccf)
