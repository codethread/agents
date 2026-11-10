# Repository lake

This lake installs public Botlake runtime packages from npm. Install Bun and the matching `botlake` and `bl` CLIs; see [Botlake workspace setup](https://github.com/codethread/botlake/blob/main/docs/usage.md#packages-and-extension-selection). The shared private `ct-config` package is installed from its Bun-packed tarball; its public peers resolve through this lake's own `node_modules`. Prepare that archive through the Botlake checkout’s install task before installing the lake.

```sh
bun install --cwd .botlake --frozen-lockfile
# If no supervisor is running, run `botlake start` in another terminal.
botlake lake start
bl help
bl work list --view all --state all
```

The manifest selects Batteries, Identity, UI, and the local flags, references, agents, priming, Work, and Work–Agents descriptors. The shared reference binding serves both Work and Agents; Work–Agents checks managed assignment liveness every 60 seconds. Selecting UI registers its commands but does not start a dashboard server. Configuration alone does not launch agents.

After changing the manifest or local configuration, reinstall dependencies and use `botlake lake restart`. Then run `botlake lake info`: every public extension `source`, `packageJson`, and `readme` path must be below this checkout's `.botlake/node_modules`, never a Botlake source checkout. Root pnpm commands remain responsible for this repository's development checks; Bun installs only lake dependencies.

Linked Git worktrees use the main checkout's lake. The local `.botlake/world.db*`, dependency installation are ignored; the Bun lockfile is committed. No legacy Beads work is imported, and no tracker Git branch is required.
