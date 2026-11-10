# CLI conventions

Use these defaults for choices the repository's CLI guidance and established commands leave open. Read the section relevant to the interface you are designing; keep existing contracts when they differ.

## Finite JSON output

- Emit one JSON document on stdout for both success and failure, with no prose mixed in and silent stderr in JSON mode.
- Use a consistent envelope: `{"ok":true,"data":...}` on success; `{"ok":false,"error":{"code":"...","message":"..."}}` on failure. Keep `code` stable for programmatic decisions and `message` actionable for the caller. Add structured error details when needed, including confirmed effects for partial mutations.
- Exit `0` on success and nonzero on failure. Document any distinct failure codes in command help; make the exit status agree with the envelope.
- Keep progress output out of finite JSON responses. If the CLI also offers human-readable output, document how callers select JSON mode.

## Streaming output

- Make streaming explicit and document its framing separately from finite JSON output. Use newline-delimited JSON, one complete record per line, with a stable `type` discriminator.
- Define data, completion and error record types. Emit a terminal completion or error record for handled outcomes so callers can distinguish a completed stream from an interrupted connection. Treat EOF without a terminal record as incomplete.
- Keep stdout limited to stream records. Put handled failures in error records and exit nonzero; make any stderr diagnostics supplementary rather than the only failure signal.

## Bundled agent instructions

Expose a nested `<cli> skills ...` interface:

| Command                     | Result                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- |
| `skills list`               | Discovery metadata: names and descriptions, without instruction bodies.         |
| `skills get <name>`         | The selected skill's Markdown body, without frontmatter or unrelated resources. |
| `skills file <name> <path>` | One supporting resource, loaded on demand.                                      |

Use [skills-handler](https://github.com/vercel-labs/skills-handler) when it fits the CLI's implementation stack. Otherwise, implement the same discovery and selective-loading behavior with the repository's tooling. Document which commands return JSON and which return instruction text or resource content in their help.
