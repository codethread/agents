# agents

An installable toolkit for Pi, Codex, and Claude Code. It ships Pi extensions and agents, reusable Codex/Claude plugins, and themes.

## What is included

| Path             | Consumer feature                                                                       |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pi/extensions/` | Pi tools, messaging, prompt, CLI, and UI extensions                                    |
| `agents/`        | Agent definitions discovered by the subagent extension                                 |
| `pi/themes/`     | Rose Pine themes for Pi                                                                |
| `plugins/`       | Coding, devflow, harness, repo-opinions, and writing plugins for Codex and Claude Code |
| `.pi/`           | Project-local configuration used only while developing this repository                 |

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

Pi reads the package resources declared in `package.json#pi`. Local package roots also contribute their direct `agents/` directory to the subagent catalog. A consumer project can override those definitions from its nearest `.pi/agents/` directory or add catalogs with repeatable `--agents-dir <path>` flags.

The package includes:

- a package-owned, tool-aware system prompt with global/project `agent.njk` rules;
- project structure and dialogue-capture context;
- built-in tool replacements and the `subagent` orchestration tool;
- prompt history, status, and other optional UI extensions;
- provider and project-rule helpers.

Agent-local MCP servers require Pi's built-in `mcp` and `codemode` extensions enabled. They use native registration and compact codemode access, not `pi-mcp-adapter`. See [the extension index](pi/extensions/README.md) and [subagent documentation](pi/extensions/tools/subagent/README.md) for configuration details.

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

## Bundled agents

| Agent    | Intended use                                             |
| -------- | -------------------------------------------------------- |
| `worker` | General implementation work with the full coding toolset |
| `scout`  | Narrow file/symbol lookups, not analysis or design       |
| `fixer`  | Validation repair and scoped mechanical fixes            |
| `hack`   | Terminal-heavy investigation and automation              |
| `review` | Read-only correctness and regression review              |
| `nerd`   | Web and documentation research with Context7 MCP access  |

Use an agent directly or delegate to it from another Pi session:

```bash
pi --agent scout --print "Find token validation definitions and their direct callers"
pi --agent review --print "Review the current changes"
```

Agent model policies live in their Markdown frontmatter. Explicit `--model`, `--thinking`, and `--tools` flags override inherited agent settings. Fixer uses `openai-codex/gpt-6-luna` with `high` thinking.
Scout uses its configured work model for projects under `~/pb/`, and DeepSeek V4 Flash with `max` thinking elsewhere. See the [Luna/Flash benchmark](agents/benchmarks/README.md) for measured speed, usage, and lookup trade-offs.

## Install the Codex plugins

Add this checkout as a local Codex marketplace:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

The marketplace exposes these plugin packages:

- `plugins/coding/` — git workflows, worktree cleanup, robustness, testing, and code cleanup;
- `plugins/devflow/` — RFC, spec, plan, task, and iterative development workflows;
- `plugins/harness/` — session introspection, dialogue capture, tmux, benchmarks, and rich responses;
- `plugins/writing/` — agent-context audits, agent-facing CLI design, Mermaid, and reusable skill authoring guidance.
- `plugins/repo-opinions/` — opinionated repository documentation conventions.

Codex does not directly run Pi extensions or Pi agent definitions. Those capabilities need Codex-native skills, hooks, MCP servers, or apps.

## Development

Skill intent and design rationale live in [`docs/skills/`](docs/skills/), one document per skill. Read the matching document before changing a skill and maintain it alongside intentional changes in behavior.

Use Node 24 and pnpm. The complete check formats only after lint, typechecking, and tests succeed:

```bash
pnpm install
pnpm check
```

Individual commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`. Vitest includes unit, snapshot, and Pi runtime integration tests backed by a patched `@gaodes/pi-test-harness`. The patch updates harness 1.0.3 for `pi-ai/compat`, `session.modelRuntime` authentication, and `agent.streamFunction` playbook injection. Integration tests resolve Pi SDK 1.5.0. Remove the patch when the upstream harness supports these APIs.

Pi host modules are wildcard peer dependencies, not runtime dependencies of the extension package. Pinned development copies support local typechecking and tests; Pi supplies the running extensions' SDK modules through its loader.

Running Pi from this checkout loads the package through `.pi/settings.json`. The project-local `.pi/extensions/pi-internals/` helper reports Pi runtime, source, settings, and extension paths when debugging the repository itself.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.
