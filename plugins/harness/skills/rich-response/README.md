# Rich response

Have an agent create its response in HTML rather than Markdown, allowing a richer view for complex discussions.

Supports:

- Mermaid with page-aligned light/dark theming
- Graphviz with readable initial light/dark normalization
- Basic styling, including callouts with spaced title lead-ins
- Tabs
- Code snippets and diffs
- Local and LAN access by default

## Local and LAN URLs

Rendering starts a short-lived HTTP server bound to all network interfaces. The agent receives two URLs for the same document and presents both so the user can choose the appropriate one:

- `http://localhost:<port>/<file>` — open on the computer running the agent
- `http://<LAN-IP>:<port>/<file>` — open from another device on the same LAN

The localhost URL opens automatically. The agent always shows both the local and LAN URLs. LAN access lasts for the same server TTL (one hour by default) and may require allowing incoming Python connections through the host firewall. Do not share the LAN URL outside a trusted network: the server exposes the rendered file's directory to devices that can reach the host and port.

![](https://github.com/user-attachments/assets/25cd1d52-e0fa-47a0-8ce8-a8a50ccdaccf)
