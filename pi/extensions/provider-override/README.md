# `provider-override`

Cwd-based provider override for managed provider pairs such as `openai` and `openai-codex`.

The extension rewrites only the provider. It preserves the selected model id and Pi thinking level. Unmanaged providers are ignored.

## Config

Runtime config is global only:

```text
~/.pi/agent/extensions/pi-provider/settings.json
```

Example:

```json
{
	"providers": ["openai", "openai-codex"],
	"default": "openai-codex",
	"paths": [
		{ "path": "~/dev/sponsored-project", "provider": "openai" },
		{ "path": "~/dev", "provider": "openai-codex" },
		{ "path": "~/work", "provider": "openai" }
	]
}
```

`paths` are ordered path-prefix rules. First match wins. A rule matches the exact configured path or any child directory. Paths must be absolute or start with `~/`; matching is lexical and does not resolve symlinks.

If no path rule matches, `default` is used for managed providers only. Providers not listed in `providers` are never rewritten.

## Failure behavior

The extension validates config with Zod and fails loudly for invalid config, unknown configured providers, missing provider auth, missing equivalent target model, or missing target auth. It does not make network requests during startup; request-time provider failures still surface when Pi sends the model request.

## Statusline

After the extension actively rewrites a selected provider, it sets status text:

```text
(override)
```
