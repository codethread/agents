# Pi Extensions

- always add `--debug-*` flags to allow you to verify results, see ./pi/extensions/system-prompt/index.ts as an example
- extensions exposing `/debug-*` commands should use `./pi/extensions/components/debug-message/index.ts` for hidden debug output so the UI stays consistent (`Ctrl+G` open in editor, `Ctrl+Enter` send to agent)
- when an extension adds new CLI flags, add them to `scripts/pi.nu` under the extension flags comment with an `[EXT]` prefix in the comment string
