# Repository lake

This checkout uses the shared `ct-config` from a sibling `botlake` checkout. Install Bun and the matching `botlake`/`bl` CLIs; see [Botlake setup](https://github.com/codethread/botlake#readme). The dependency paths in `package.json` expect `agents/` and `botlake/` beside each other.

```sh
bun install --cwd .botlake
# If no supervisor is running, run `botlake start` in another terminal.
botlake lake start
bl help
bl work list --view all --state all
```

The manifest selects Batteries, Identity, and the shared flags, references, agents, priming, Work, and Work–Agents descriptors. It does not select UI or repository-specific agent overrides. The shared reference binding serves both Work and Agents; Work–Agents checks managed assignment liveness every 60 seconds. Configuration alone does not launch agents.

After changing the manifest or updating installed shared configuration, use `botlake lake restart`. `botlake lake info` reports the loaded extension snapshot. Root pnpm commands remain responsible for this repository's development checks; Bun installs only lake dependencies.

Linked Git worktrees use the main checkout's lake. The local `.botlake/world.db*`, dependency installation, and Bun lockfile are ignored. No legacy Beads work is imported, and no tracker Git branch is required.
