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
pnpm install
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
- prompt history, status, and other optional UI extensions;
- provider and project-rule helpers.

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
bunx @codethread/skillbox add codethread/agents dev coding writing harness
# Optional planning and AFK workflows; install coding alongside devflow.
bunx @codethread/skillbox add codethread/agents devflow
```

For an unpublished local checkout, use its repository root instead:

```bash
bunx @codethread/skillbox add /absolute/path/to/agents dev coding writing harness devflow
```

| Bundle    | Contents                                                                                |
| --------- | --------------------------------------------------------------------------------------- |
| `dev`     | TypeScript and repository documentation conventions                                     |
| `coding`  | Git workflows, robustness, worktree cleanup, and code cleanup                           |
| `writing` | Agent-context audits, agent-facing CLI design, Mermaid, and agent instruction authoring |
| `harness` | Session introspection, benchmarks, rich responses, and tmux workflows                   |
| `devflow` | Planning lifecycle, user-invoked stages, and AFK automation                             |

Skillbox copies skills and their supporting files into `.agents/skills/` and links `.claude/skills` to it. Commit `skillbox/config.json` and `skillbox/lock.json` in the consuming project; restore with `bunx @codethread/skillbox sync`. It rejects existing unmanaged skill directories rather than overwriting them. Keep source changes in this repository's bundles, not in generated client copies.

Former slash commands are user-invoked skills: Claude Code uses `/<name>`, Pi uses `/skill:<name>`, and Codex uses `$<name>`. In Pi, trust/approve the consuming project to enable project-local skill discovery. Repeated hyphens in the old `flow-*` names are now single hyphens (for example, `flow-init-afk`). The duplicate cleanup/router commands are named `declutter-session` and `devflow-start`; the original general-purpose entrypoints remain available. See [Devflow](docs/devflow.md) for planning and AFK usage.

## Harness hooks

Skillbox distributes skill files, not hooks. The existing `harness` plugin remains for Claude Code and Codex; all skills-only plugins have been removed from the marketplaces. Retire the old coding, devflow, writing, and repo-opinions plugin installations in your harness when adopting the bundles. Update the harness plugin to its hooks-only version rather than removing it if you still want dialogue capture or window titles.

For Codex, add this checkout as a local marketplace and enable its `harness` plugin through Codex's plugin interface:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

The Claude marketplace likewise exposes only `harness`. See the [hook reference](plugins/harness/README.md) for behavior and log schema. Codex does not directly run Pi extensions.

## Development

Use Node 24 and pnpm. The complete check formats only after lint, typechecking, and tests succeed:

```bash
pnpm install
pnpm check
```

Individual commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`. Vitest includes unit, snapshot, and Pi runtime integration tests backed by a patched `@gaodes/pi-test-harness`. The patch updates harness 1.0.3 for `pi-ai/compat`, `session.modelRuntime` authentication, and `agent.streamFunction` playbook injection. Integration tests resolve Pi SDK 1.5.0. Remove the patch when the upstream harness supports these APIs.

Pi host modules are wildcard peer dependencies, not runtime dependencies of the extension package. Pinned development copies support local typechecking and tests; Pi supplies the running extensions' SDK modules through its loader.

Running Pi from this checkout loads the package through `.pi/settings.json`. The project-local `.pi/extensions/pi-internals/` helper reports Pi runtime, source, settings, and extension paths when debugging the repository itself.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.
