# `pi-discovery`

> Append Pi runtime source paths plus discovered extension source paths as a one-shot contextual note when the user explicitly mentions `Pi`.

Makes Pi aware of both:

- where the running Pi installation/source tree lives
- which extension entry files are currently enabled in the session environment

On the first raw user message in an extension runtime that contains standalone, case-sensitive `Pi`, it appends a **compact XML note** containing:

- a short `note` attribute telling Pi to inspect these paths directly when relevant
- global/project Pi config paths relevant to extension discovery
- a `<pi_source>...</pi_source>` text block containing the Pi docs/examples guidance text and resolved paths; this remains multiline even in the injected agent-visible note so the prose keeps its structure
- notably omits redundant runtime-package/store paths from the displayed XML to keep tokenization cleaner
- enabled extension entrypoint files
- extension provenance metadata (`scope`, `source`, `origin`, `baseDir`)

This is useful when a user references Pi behavior, installed extensions, prompt variables, or package-provided runtime features and wants Pi to inspect the real implementation directly instead of guessing.

When the request is about Pi behavior, inspect the relevant Pi source/docs first, then inspect the matching discovered extension source files before answering instead of inferring behavior from memory.

Useful Pi package-relative paths surfaced by this extension include:

- `$PI_PACKAGE_DIR/docs`
- `$PI_PACKAGE_DIR/examples`
- `$PI_PACKAGE_DIR/dist/core/tools`

The built-in tool prompt metadata manually vendored by `owned-system-prompt` is refreshed from files under `dist/core/tools/*.js`, so surfacing that directory here keeps the source-of-truth path discoverable in Pi-specific conversations.

**Command:** `/debug-extensions` — shows the current Pi source + extension discovery report in the UI only (hidden from the agent), using a multiline XML view for readability.

## Implementation layout

- `index.ts` — Pi extension entry point
- `context-note.ts` — session warm-up, one-shot input injection, and `/debug-extensions`
- `extension-discovery.ts` — compatibility export surface for discovery, rendering, and trigger helpers
- `discovery.ts` — Pi runtime/source and enabled extension discovery
- `source-utils.ts` — path/source normalization helpers
- `rendering.ts` — compact and debug XML rendering
