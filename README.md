# agents

An installable toolkit for Pi, Codex, and Claude Code. It ships Skillbox bundles, Pi extensions and themes, and a hooks-only harness plugin.

## What is included

| Path               | Consumer feature                                                           |
| ------------------ | -------------------------------------------------------------------------- |
| `pi/extensions/`   | Pi tools, messaging, prompt, CLI, and UI extensions                        |
| `pi/themes/`       | Rose Pine themes for Pi                                                    |
| `skillbox/`        | Repository-local skill bundles, including user-invoked workflow commands   |
| `plugins/harness/` | Claude Code and Codex dialogue-capture hooks and Claude window-title hooks |
| `.pi/`             | Project-local configuration used only while developing this repository     |

## Install the Pi package

Use Pi 1.5.0 or newer, matching the SDK version used for development and testing.

From a local checkout:

```bash
bun install
pi install /absolute/path/to/agents
```

Or install from GitHub:

```bash
pi install git:github.com/codethread/agents
```

Pi reads the package resources declared in `package.json#pi`, including the source bundles under `skillbox/`. Do not also install those same bundles into a Pi workspace unless you disable the package's skills there to avoid duplicate discovery.

The package includes:

- a package-owned, tool-aware system prompt with global/project `agent.njk` rules;
- project structure and dialogue-capture context;
- built-in tool replacements;
- explicitly authorized [self-termination](pi/extensions/tools/self-terminate/README.md), with graceful Pi shutdown and optional Rex tab cleanup;
- prompt history, status, and other optional UI extensions;
- provider and project-rule helpers;
- session-only MCP servers from JSON or files with `--mcp-config <json|file>`.

## Rosé Pine themes

The package includes the custom Dawn and Moon palettes. Use Pi's native automatic
selection by setting this in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
	"theme": "rose-pine-dawn/rose-pine-moon"
}
```

The light theme comes first. Pi switches palettes when the terminal reports an
appearance change; the shared `color-theme` sentinel is no longer used. This
checkout selects the pair in its project settings, without changing global settings.

## Install project skills with Skillbox

Run from a consuming project:

```bash
bunx @codethread/skillbox@0.5.0 add skillbox codethread/agents agents \
  --bundle dev --bundle coding --bundle discussion --bundle projects --bundle writing --bundle harness
```

For an unpublished local checkout, use its repository root instead:

```bash
bunx @codethread/skillbox@0.5.0 add skillbox /absolute/path/to/agents agents \
  --bundle dev --bundle coding --bundle discussion --bundle projects --bundle writing --bundle harness
```

| Bundle       | Contents                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| `dev`        | TypeScript                                                                              |
| `coding`     | Git workflows, robustness, worktree cleanup, and code cleanup                           |
| `discussion` | Design vocabulary, domain modeling, plan interviews, and rich responses                 |
| `writing`    | Agent-context audits, agent-facing CLI design, Mermaid, and agent instruction authoring |
| `harness`    | Browser automation, session introspection, benchmarks, and tmux workflows               |
| `projects`   | GitHub project guidance and repository documentation conventions                        |

The `discussion` bundle imports design and interview guidance from [mattpocock/skills](https://github.com/mattpocock/skills); `writing` imports agent instruction authoring from the same source. Skillbox records exact upstream revisions in this repository's lockfile.

The destination id `agents` combines the selected upstream bundles and is added to the consuming project's `install` list. Skillbox copies skills and their supporting files into `.agents/skills/` and links `.claude/skills` to it. Commit `skillbox/config.json` and `skillbox/lock.json` in the consuming project; restore with `bunx @codethread/skillbox@0.5.0 sync`. Git sources remain pinned until an explicit reviewed update. It rejects existing unmanaged skill directories rather than overwriting them. Keep source changes in this repository's bundles, not in generated client copies.

Former slash commands are user-invoked skills: Claude Code uses `/<name>`, Pi uses `/skill:<name>`, and Codex uses `$<name>`. In Pi, trust/approve the consuming project to enable project-local skill discovery. Related commands use domain-first names so they group together in skill pickers: `session-introspection-{claude,codex,pi}` and `git-{commit,worktree-cleanup}`. Use `declutter` for session cleanup, including harvesting durable outcomes before removing completed plan/task artifacts.

## Harness hooks

Skillbox distributes skill files, not hooks. The existing `harness` plugin remains for Claude Code and Codex; all skills-only plugins have been removed from the marketplaces. Retire the old coding, writing, and repo-opinions plugin installations in your harness when adopting the bundles. Update the harness plugin to its hooks-only version rather than removing it if you still want dialogue capture or window titles.

For Codex, add this checkout as a local marketplace and enable its `harness` plugin through Codex's plugin interface:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

The Claude marketplace likewise exposes only `harness`. See the [hook reference](plugins/harness/README.md) for behavior and log schema. Codex does not directly run Pi extensions.

## Development

This checkout pins Skillbox `0.5.0`. Its `skillbox/config.json` installs `coding`, `dev`, `discussion`, `harness`, `projects`, and `writing`, combining native bundles with pinned upstream contributions. The version 2 `skillbox/lock.json` records bundle provenance and managed installations. Restore them with `bun run --no-install skillbox sync`; edit the source bundles rather than installed copies. Generated `.agents/skills/` copies and the `.claude/skills` symlink are ignored by Git; quality checks exclude the installed copies. The symlink points to `.agents/skills/`. Any separate root `skills-lock.json` belongs to other tooling and is not managed by Skillbox.

Skillbox owns the tracked `skillbox/lock.json`; Prettier ignores it. For commits touching `skillbox/`, pre-commit syncs the shared lockfile after formatting. Stage or set aside any other edits under `skillbox/` and temporarily move `skillbox/.local/config.json` aside if you use a personal config. If sync changes the lockfile, review and stage it before retrying the commit.

Keep skill frontmatter descriptions as single-line quoted YAML strings for Claude compatibility.

Install mise, trust this repository's configuration with `mise trust`, then run `mise run` from the repository root. The pinned Bun and Node versions prepare all workspace dependencies with one root install and `bun.lock`, generated Skillbox copies, and local Git hooks. Node remains the runtime for Pi tooling and Vitest. Bootstrap does not start the lake or a server. Start the lake explicitly with `mise run lake-start` when needed and verify it with `botlake lake info --workspace "$(pwd)"`.

Run the complete check with `bun run check`; it lints and typechecks the lake sources as well as the Pi extensions, runs tests, formats, then verifies changelog sync. Individual commands are `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run format`. Use `bun run changelog` to query the recorded root-package history, `bun run changelog:generate` to regenerate `CHANGELOG.md`, and `bun run changelog:check` to verify it. The root package history starts at version 0.1.0; no earlier release notes are recorded.

The root Pi package and private `agents-workspace` package in `.botlake/` share the root ESLint and Prettier configuration and `tsconfig.base.json`. Pi keeps its Node-specific TypeScript settings; Botlake keeps `exactOptionalPropertyTypes` enabled. Root checks cover both packages, project scripts, and TypeScript shipped in the skill bundles. Target only the lake with `bun run --filter agents-workspace lint`, `bun run --filter agents-workspace typecheck`, or `bun run --filter agents-workspace format`; dependencies are still installed from the repository root.

`bun run test` uses Vitest, not Bun's test runner. Vitest includes unit, snapshot, and Pi runtime integration tests backed by a patched `@gaodes/pi-test-harness`. The patch updates harness 1.0.3 for `pi-ai/compat`, `session.modelRuntime` authentication, and `agent.streamFunction` playbook injection. Integration tests resolve Pi SDK 1.5.0. Remove the patch when the upstream harness supports these APIs.

Pi host modules are wildcard peer dependencies, not runtime dependencies of the extension package. Pinned development copies support local typechecking and tests; Pi supplies the running extensions' SDK modules through its loader.

Running Pi from this checkout loads the package through `.pi/settings.json`. The bundled [`pi-internals`](pi/extensions/tools/pi-internals/README.md) tool reports Pi runtime, source, settings, and enabled extension paths on demand.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.
