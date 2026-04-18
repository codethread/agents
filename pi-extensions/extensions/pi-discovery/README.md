# `pi-discovery`

> Append discovered extension source paths as a one-shot contextual note when the user explicitly mentions `Pi`.

Makes Pi aware of the extension code currently available in the running environment without injecting that catalog into every turn. On the first raw user message in an extension runtime that contains standalone, case-sensitive `Pi`, it appends a compact XML note containing:

- global/project Pi config paths relevant to extension discovery
- enabled extension entrypoint files
- extension provenance metadata (`scope`, `source`, `origin`, `baseDir`)

This is useful when a user references an installed extension and wants Pi to inspect the implementation directly instead of guessing.

When the request is about Pi behavior, installed extensions, prompt variables, or package-provided runtime features, inspect the relevant Pi docs and the discovered extension source files before answering instead of inferring behavior from memory.

**Command:** `/debug-extensions` — sends the current extension discovery report into the conversation.
