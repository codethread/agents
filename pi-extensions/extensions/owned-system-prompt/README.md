# `owned-system-prompt`

> Own Pi's base prompt scaffold while preserving normal `before_agent_start` chaining.

This extension assumes you replace Pi's default base prompt with a tiny custom `SYSTEM.md`, then it appends this package's owned tool and guideline sections during `before_agent_start` inside one `<system_reminder type="harness">...</system_reminder>` block.

That keeps later prompt-mutating extensions like `dynamic-agents-md` and `subagent` working unchanged: they see the owned prompt as their input prompt and can continue appending normally.

## Required setup

Create `~/.pi/agent/SYSTEM.md` with exactly this line:

```md
You are an expert coding assistant operating inside pi, a coding agent harness.
```

Pi core will still append context files, skills, current date, and current working directory after loading that file.

If the default Pi base prompt is still present, this extension deliberately does nothing so it does not duplicate Pi's built-in tool/guideline sections.

## What this extension owns

The extension appends:

- the package-owned `Available tools` section for Pi built-in tools
- the package-owned `Guidelines` section for Pi built-in tools
- the short bridge line about other custom tools potentially being available

It intentionally does **not** try to reconstruct prompt metadata for custom extension tools, because Pi does not currently expose custom-tool `promptSnippet` / `promptGuidelines` metadata through `pi.getAllTools()`.

## Debug flag

**Flag:** `--debug-owned-prompt` — prints the current effective system prompt and exits.

Example:

```bash
pi --debug-owned-prompt ping
```

## Refreshing built-in tool metadata

The built-in tool prompt strings in this extension are manually synced from Pi.
When upgrading Pi, re-check these package-relative files:

- `$PI_PACKAGE_DIR/dist/core/tools/read.js`
- `$PI_PACKAGE_DIR/dist/core/tools/bash.js`
- `$PI_PACKAGE_DIR/dist/core/tools/edit.js`
- `$PI_PACKAGE_DIR/dist/core/tools/write.js`
- `$PI_PACKAGE_DIR/dist/core/tools/grep.js`
- `$PI_PACKAGE_DIR/dist/core/tools/find.js`
- `$PI_PACKAGE_DIR/dist/core/tools/ls.js`

If `PI_PACKAGE_DIR` is not set, resolve the installed package path and inspect the same `dist/core/tools/*.js` files there.
