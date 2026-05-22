# Web Access

Registers two simple web tools:

- `web_search` — searches Exa using `EXA_API_KEY` from the process environment.
- `fetch_content` — fetches one HTTP(S) URL and returns readable markdown/text.

No provider fallback, GitHub cloning, YouTube/video handling, PDFs, curator UI, or MCP proxy.

## Config

Set `EXA_API_KEY` globally in your shell environment before launching Pi.

## Debug

```sh
pi --debug-web-access "search latest TypeScript release"
pi --debug-web-access "fetch https://example.com"
```
