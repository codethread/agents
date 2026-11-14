# Repository lake

This lake installs public Botlake runtime packages from npm. Install Bun and the matching `botlake` and `bl` CLIs; see [Botlake workspace setup](https://github.com/codethread/botlake/blob/main/docs/usage.md#packages-and-extension-selection). The shared `@botlake/extension-ct-config` preset is an ordinary npm dependency; its public peers resolve through Bun’s isolated workspace links, and its UI dependency is installed transitively rather than declared directly.

From the repository root, `mise run` installs all dependencies with one Bun workspace install and the root `bun.lock`. To reinstall dependencies without the rest of bootstrap, run `bun install --frozen-lockfile` at the repository root. This private `agents-workspace` package owns the lake dependencies; development tools and configuration are shared with the root package.

The bootstrap does not start Botlake processes. With a supervisor already running, activate this lake explicitly when needed, then inspect its loaded extensions and commands:

```sh
botlake lake start --workspace "$(pwd)"
botlake lake info --workspace "$(pwd)"
bl --workspace "$(pwd)" help
bl --workspace "$(pwd)" work list --view all --state all
```

The manifest selects Batteries, Identity, the shared preset's UI and Mail descriptors, and the local flags, references, agents, priming, Work, and Work–Agents descriptor modules. Those local modules re-export the preset's configured descriptors. Mail includes identity links, automatic live delivery, and five-minute agent resumption through the exact shared Agents binding. The shared reference binding serves both Work and Agents; Work–Agents checks managed assignment liveness every 60 seconds. Selecting UI registers its commands but does not start a dashboard server. Configuration alone does not launch agents.

After changing the manifest or local configuration, reinstall dependencies and use `botlake lake restart`. Then run `botlake lake info`: every public extension `source`, `packageJson`, and `readme` path must resolve below this checkout's root `node_modules` store, never a Botlake source checkout. Root `bun run check` covers the lake alongside the Pi package. For lake-only checks, use `bun run --filter agents-workspace lint` and `bun run --filter agents-workspace typecheck`; the latter extends the shared TypeScript defaults with `exactOptionalPropertyTypes` enabled.

Linked Git worktrees use the main checkout's lake. The local `.botlake/world.db*` files and dependency installations are ignored; the root Bun lockfile is committed. No legacy Beads work is imported, and no tracker Git branch is required.
