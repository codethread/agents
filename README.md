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

The root package contains Pi resources only; it does not install Pies or its CLI bins. Pies is the separate `@codethread/pies` workspace package under `pies/`.

Pi reads the package resources declared in `package.json#pi`. Local package roots also contribute their direct `agents/` directory to the subagent catalog. A consumer project can override those definitions from its nearest `.pi/agents/` directory or add catalogs with repeatable `--agents-dir <path>` flags.

The package includes:

- a package-owned, tool-aware system prompt with global/project `agent.njk` rules;
- project structure and dialogue-capture context;
- built-in tool replacements and the `subagent` orchestration tool;
- prompt history, status, timeline, and other optional UI extensions;
- provider and project-rule helpers.

See [the extension index](pi/extensions/README.md) and [subagent documentation](pi/extensions/tools/subagent/README.md) for configuration details.

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

Agent model policies live in their Markdown frontmatter. Explicit `--model`, `--thinking`, and `--tools` flags override inherited agent settings.
Scout uses DeepSeek V4 Flash with `max` thinking; see the [Luna/Flash benchmark](agents/benchmarks/README.md) for measured speed, usage, and lookup trade-offs.

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

Individual commands are `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm format`. The complete check also builds the standalone Pies distribution before testing. Vitest includes unit, snapshot, and Pi runtime integration tests backed by a patched `@gaodes/pi-test-harness`. The patch updates harness 1.0.3 for `pi-ai/compat`, `session.modelRuntime` authentication, and `agent.streamFunction` playbook injection. Integration tests and the Pies workspace resolve Pi SDK 0.99.1. Remove the patch when the upstream harness supports these APIs.

Pi host modules are wildcard peer dependencies, not runtime dependencies of the extension package. Pinned development copies support local typechecking and tests; Pi supplies the running extensions' SDK modules through its loader. The independent `@codethread/pies` package owns its pinned runtime SDK dependencies and CLI bins; root wrappers launch its source entrypoints without changing the working directory.

Running Pi from this checkout loads the package through `.pi/settings.json`. The project-local `.pi/extensions/pi-internals/` helper reports Pi runtime, source, settings, and extension paths when debugging the repository itself.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.

## Millstrand identity dependency

Native identity registration lives in [`millhouse.spool/spools/harnesses`](https://github.com/codethread/millhouse.spool/tree/main/spools/harnesses), consumed as a commit-pinned `@millhouse/harnesses` dependency. The prompt extension renders the canonical identity instruction and publishes its name through Pi's status API. Subagents retain parent attribution but resolve their own identities and workspaces.

There is no managed-guidance protocol in this package. Identity needs a running Weaver supporting `strand agent native-startup`; installing the JavaScript dependency does not update it. Identity is optional: unavailable or invalid Millstrand workspaces never block Pi or emit startup errors. Use `/debug-millstrand-identity` to inspect lookup diagnostics. See [identity lifecycle and debug commands](pi/extensions/system-prompt/README.md#identity-lifecycle).
