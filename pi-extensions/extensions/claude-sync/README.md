# `claude-sync`

> Synchronize Claude project context with Pi — transparent to the user.

On startup, walks upward from `cwd` to find the nearest `.claude/` directory and symlinks any `.md` files into the equivalent `.pi/` location. This lets Pi reuse Claude-authored project context automatically.
