# `statusline`

> Persistent status bar — transparent to the user.

Renders a footer at the bottom of the TUI showing:

- Context token usage (color-coded: >70% ⚠️, >90% 🔴)
- Cumulative session cost, with `cache long` when `PI_CACHE_RETENTION=long` is enabled
- Temporary cache-miss warning (`❗cache miss HH:mm`) for one minute after an assistant turn reports `cacheRead === 0` following prior cache reuse
- Working directory, git branch, session name, and session ID
- Active model and provider
