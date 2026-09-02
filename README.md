# agents

An installable toolkit for Pi, Codex, and Claude Code. It ships Pi extensions and agents, reusable Codex/Claude plugins, themes, and `pies`: a memory-efficient daemon for concurrent headless Pi sessions.

## What is included

| Path             | Consumer feature                                                        |
| ---------------- | ----------------------------------------------------------------------- |
| `pi/extensions/` | Pi tools, messaging, prompt, CLI, and UI extensions                     |
| `agents/`        | Agent definitions discovered by the subagent extension                  |
| `pi/themes/`     | Rose Pine themes for Pi                                                 |
| `plugins/`       | Coding, devflow, harness, and writing plugins for Codex and Claude Code |
| `pies/`          | Persistent Pi SDK daemon, thin CLI, and `pi` compatibility shim         |
| `.pi/`           | Project-local configuration used only while developing this repository  |

## Install the Pi package

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
- prompt history, status, timeline, theme, and other optional UI extensions;
- provider, project-rule, and print-mode helpers.

See [the extension index](pi/extensions/README.md) and [subagent documentation](pi/extensions/tools/subagent/README.md) for configuration details.

## Run concurrent headless agents with Pies

Pies keeps the Pi SDK and extension graph in one persistent Node process while each invocation receives an isolated runtime, environment, session, tools, and output stream.

```bash
pnpm link:pi

pi --model openai/gpt-5.6-luna --print "Summarise this repository"
pi --agent worker --print "Run the checks and fix failures"
pies daemon status
```

After linking, `pi --print` routes through Pies and ordinary interactive `pi` still hands the TTY to the real executable. See [the Pies consumer guide](pies/README.md) for installation, routing, configuration, logs, concurrency behavior, benchmarks, and limitations.

## Bundled agents

| Agent    | Intended use                                             |
| -------- | -------------------------------------------------------- |
| `worker` | General implementation work with the full coding toolset |
| `scout`  | Focused codebase and architecture reconnaissance         |
| `fixer`  | Validation repair and scoped mechanical fixes            |
| `hack`   | Terminal-heavy investigation and automation              |
| `review` | Read-only correctness and regression review              |
| `nerd`   | Web and documentation research with Context7 MCP access  |

Use an agent directly or delegate to it from another Pi session:

```bash
pi --agent scout --print "Map the authentication flow"
pi --agent review --print "Review the current changes"
```

Agent model policies live in their Markdown frontmatter. Explicit `--model`, `--thinking`, and `--tools` flags override inherited agent settings.

## Install the Codex plugins

Add this checkout as a local Codex marketplace:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

The marketplace exposes these plugin packages:

- `plugins/coding/` — git workflows, robustness, testing, and code cleanup;
- `plugins/devflow/` — RFC, spec, plan, task, and iterative development workflows;
- `plugins/harness/` — session introspection, dialogue capture, tmux, benchmarks, and rich responses;
- `plugins/writing/` — Mermaid and reusable skill authoring guidance.

Codex does not directly run Pi extensions or Pi agent definitions. Those capabilities need Codex-native skills, hooks, MCP servers, or apps.

## Development

Use Node 24 and pnpm. The complete check formats only after lint, typechecking, and tests succeed:

```bash
pnpm install
pnpm check
```

Individual commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`. Vitest includes unit, snapshot, and Pi runtime integration tests backed by `@gaodes/pi-test-harness`.

Running Pi from this checkout loads the package through `.pi/settings.json`. The project-local `.pi/extensions/pi-internals/` helper reports Pi runtime, source, settings, and extension paths when debugging the repository itself.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.
