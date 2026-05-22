# `pi-internals`

> Register the `pi-internals` tool, which prints Pi runtime/source paths and enabled extension entrypoints on demand.

Agents call `pi-internals` when they need Pi runtime, documentation, settings, or extension paths.

The tool returns a plain-text list containing:

- a short instruction to inspect paths directly when relevant
- global/project Pi config paths relevant to extension discovery
- Pi docs/examples guidance and resolved paths
- enabled extension entrypoint files
- extension provenance metadata (`scope`, `source`, `origin`, `baseDir`)

When the request is about Pi behavior, call `pi-internals`, then inspect the relevant Pi docs/source and discovered extension source files before answering.

**Tool:** `pi-internals` — returns the full plain-text Pi internals report to the agent. Its TUI renderer shows only a terse lookup summary to the user.

**Command:** `/debug-pi-internals` — shows the current full Pi internals report in the shared debug panel, hidden from the agent unless explicitly sent.

**Flag:** `--debug-pi-internals` — prints the Pi internals report and exits.

## Implementation layout

- `index.ts` — extension entrypoint; registers the tool, debug command, debug flag, and terse TUI renderer
- `discovery.ts` — Pi runtime/source and enabled extension discovery
- `rendering.ts` — full plain-text report rendering
