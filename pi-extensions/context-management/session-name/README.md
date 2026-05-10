# Session name

Set Pi's session display name from the CLI.

```bash
pi --name "refactor auth"
```

Pi exposes `setSessionName()` to extensions, so this extension registers a `--name` flag and applies it on `session_start`. The name appears anywhere Pi uses the session display name, including `/tree` and session selectors.

## Debug

```bash
pi --debug-session-name --name "refactor auth"
```

Prints the resolved name and exits.
