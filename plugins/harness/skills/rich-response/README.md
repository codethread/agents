# Rich response

Have an agent create its response in HTML rather than Markdown, allowing a richer view for complex discussions.

Supports:

- Mermaid with page-aligned light/dark theming
- Graphviz with readable initial light/dark normalization
- Basic styling, including callouts with spaced title lead-ins
- Tabs
- Code snippets and diffs
- Local and LAN access by default

## Persistent local and LAN URLs

Rendering publishes the completed HTML to an idempotent document server on fixed port `8765`. The first render starts the server in a detached process; later renders reuse it. Publishing the same document replaces it atomically while keeping its URLs stable.

The publishing API accepts writes from localhost only. Documents are readable locally and over the LAN. The agent receives two URLs for the same document and presents both so the user can choose the appropriate one:

- `http://localhost:8765/documents/<id>` — open on the computer running the agent
- `http://<LAN-IP>:8765/documents/<id>` — open from another device on the same LAN

The localhost URL opens automatically. The agent always shows both the local and LAN URLs. LAN access remains available while the server is running and may require allowing incoming Python connections through the host firewall. The server exposes only published documents, without directory listings; do not share the LAN URL outside a trusted network.

![](https://github.com/user-attachments/assets/25cd1d52-e0fa-47a0-8ce8-a8a50ccdaccf)
