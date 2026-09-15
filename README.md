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

## Install the Codex plugins

Add this checkout as a local Codex marketplace:

```bash
codex plugin marketplace add /absolute/path/to/agents
```

The marketplace exposes these plugin packages:

- `plugins/coding/` — git workflows, robustness, testing, and code cleanup;
- `plugins/devflow/` — RFC, spec, plan, task, and iterative development workflows;
- `plugins/harness/` — session introspection, dialogue capture, native Codex startup identity, tmux, benchmarks, and rich responses;
- `plugins/writing/` — Mermaid and reusable skill authoring guidance.

Codex does not directly run Pi extensions or Pi agent definitions. Those capabilities need Codex-native skills, hooks, MCP servers, or apps.

## Development

Use Node 24 and pnpm. The complete check formats only after lint, typechecking, and tests succeed:

```bash
pnpm install
pnpm check
```

Individual commands are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`. Run `pnpm test:managed-guidance-preflight` for the focused no-model Codex/Pi capability probe suite and `pnpm test:codex-hooks` for Codex hook conformance. Vitest includes unit, snapshot, and Pi runtime integration tests backed by `@gaodes/pi-test-harness`.

Running Pi from this checkout loads the package through `.pi/settings.json`. The project-local `.pi/extensions/pi-internals/` helper reports Pi runtime, source, settings, and extension paths when debugging the repository itself.

Changing prompt-layer context or switching models/providers can reduce provider prompt-cache reuse. Keep dynamic injected context bounded and stable when cache reuse matters.

## Disabled managed-guidance adapters

This package contains the Agents-owned, disabled `native-v1` adapters for Codex CLI 0.154.0 and `@earendil-works/pi-coding-agent` 0.84.4. Capability inspection is no-model and read-only:

```text
node scripts/managed-guidance-preflight.mjs
```

The executable reads one `millstrand.agent-guidance-preflight/v1` request from stdin. Required fields are `schema`, `harness` (`codex` or `pi`), `executable`, `mode` (`headless` or `interactive`), `cwd`, `workspace`, `env`, `extra-argv`, and `resumes`. `executable` must be an existing absolute file; `cwd` and `workspace` must be existing canonical absolute directories without symlinks. `env` must contain only string values, and `extra-argv` must contain only strings. `model`, `effort`, and `native-session-id` are optional, except that `native-session-id` is required when `resumes` is true.

```json
{
	"schema": "millstrand.agent-guidance-preflight/v1",
	"harness": "codex",
	"executable": "/absolute/path/to/codex",
	"mode": "headless",
	"cwd": "/absolute/path/to/project",
	"workspace": "/absolute/path/to/project/.millstrand",
	"env": {
		"HOME": "/absolute/path/to/home",
		"CODEX_HOME": "/absolute/path/to/home/.codex",
		"PATH": "/usr/local/bin:/usr/bin:/bin"
	},
	"extra-argv": ["--enable", "hooks"],
	"resumes": false
}
```

Every response is one bounded JSON object followed by a newline. A `capable` response's public `capability` object has `schema`, `harness`, `adapter-contract`, `adapter-sha256`, `executable-sha256`, `host-version`, `launch-profile-sha256`, `max-context-bytes`, and `hook-fact`. Codex reports a 3,072-byte managed context limit. Its hook fact records separate `sessionStart` and `subagentStart` entries with the exact command, source, trust, timeout, and configured context limit; `adapter-sha256` binds their shared adapter closure.

Pi reports a 65,536-byte managed context limit. Its hook fact has `host-package`, `host-package-version`, `host-package-sha256`, `extensions` (ordered `entrypoint` and `closure-sha256` facts), `prompt-owner-entrypoint`, and `system-prompt-options-contract`. The effective Pi profile is reconstructed from global and project settings using each scope's own path base, enabled local packages, auto-discovered extension directories, split `-e`/`--extension` arguments, and `-ne`/`--no-extensions`. Pi 0.84.4 treats leading `+`/`-` package-source characters literally and ignores attached `--extension=PATH`, so preflight does not reinterpret either form. An overlapping global/project package declaration with project `autoload:false` is reported as unverifiable until the host's delta semantics are modeled. Every effective entrypoint must belong to this reviewed Agents package, exactly one canonical `system-prompt` owner must remain, and competing Pi system/append prompt files or CLI options are rejected. Symlinks encountered during extension-directory discovery make the profile unverifiable rather than being omitted from evidence. The launch-profile digest also binds mode, cwd, workspace, executable, arguments, resume/session, model, effort, and those hook facts.

| `result`          | Top-level schema                         | Additional fields                                                                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `capable`         | `millstrand.agent-guidance-preflight/v1` | `capability`, whose schema is `millstrand.agent-guidance-capability/v1` and includes the public fields above |
| `legacy-required` | `millstrand.agent-guidance-preflight/v1` | `code` and a bounded `diagnostic`                                                                            |

`legacy-required` failure codes are:

| Code                   | Meaning                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `unsupported-host`     | The executable or resolved host package is not the pinned Codex 0.154.0 or Pi 0.84.4 profile |
| `missing-hook`         | The required managed injector or Pi prompt owner is not effective                            |
| `changed-hook`         | The hook command, manifest, limits, or adapter closure differs from the reviewed profile     |
| `untrusted-hook`       | Codex does not report the approved trusted plugin registration                               |
| `duplicate-injector`   | More than one managed injector or Pi prompt owner is effective                               |
| `unverifiable-profile` | The request, selectors, paths, configuration, or effective Pi extension profile is invalid   |
| `probe-failed`         | The bounded Codex `hooks/list` probe could not produce usable evidence                       |

For Pi specifically, `unsupported-host` covers a version or resolved `@earendil-works/pi-coding-agent` 0.84.4 package mismatch; `missing-hook` means the owned renderer is absent; `duplicate-injector` means it is effective more than once; and `unverifiable-profile` covers unreviewed/missing extension paths, invalid settings or selectors, competing prompt sources/options, and other profile evidence that cannot be verified. Codex additionally uses `changed-hook`, `untrusted-hook`, and `probe-failed` for its effective hook evidence.

Profile evidence accounts for split and attached Codex feature selectors, rejects Codex profile selectors and unsupported Codex `extra-argv`, and treats Pi `-ne` exactly like `--no-extensions`. A completed Codex `hooks/list` probe is shut down with a bounded, awaited exact-child TERM/KILL sequence. Preflight does not select transport, mutate configuration, create sessions, call Strand startup, or make model requests. Harnesses remains the sole admission owner, and its approved adapter/preflight allowlist is intentionally empty until coordinated acceptance. Consequently these sources do not enable native delivery by installation alone; omitted metadata keeps existing legacy/unmanaged behavior.
