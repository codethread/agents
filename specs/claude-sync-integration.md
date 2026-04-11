# Claude Sync Integration Specification

**Status:** Implemented
**Last Updated:** 2026-04-06

## 1. Overview

### Purpose

The Claude sync extension gives Pi a compatibility bridge for Claude-oriented project resources. It discovers Claude resource roots at the user and project levels, then exposes selected Claude content to Pi by creating symlinks inside Pi's resource directories. This domain covers root discovery, symlink safety rules, command-to-prompt name translation, per-target result reporting, and the extension lifecycle hooks that ensure syncing happens before Pi resource discovery proceeds.

### Goals

- Discover a user Claude root at `~/.claude` when present.
- Discover the nearest project Claude root by walking upward from the current working directory.
- Mirror Claude `skills/` and `agents/` directories into Pi via symlinks instead of copying files.
- Translate Claude `commands/**/*.md` files into Pi prompt filenames under `prompts/` using colon-delimited names.
- Avoid destructive filesystem mutations when pre-existing paths or conflicting symlinks are encountered.
- Surface sync results as warnings or informational notifications at session start.
- Ensure the sync completes before Pi resource discovery consumes the mirrored resources.

### Non-Goals

- Bidirectional sync between Pi and Claude. The flow is Claude-to-Pi only.
- Copying or transforming file contents. The integration uses symlinks rather than duplicating markdown.
- Deleting stale Pi symlinks when Claude files disappear. The current implementation only creates links and warns on unsafe existing paths.
- Overwriting conflicting files, directories, or symlinks that already point elsewhere.
- Supporting arbitrary Claude resource types beyond `skills`, `agents`, and markdown files under `commands`.
- Providing an explicit user command to trigger re-sync mid-session. Sync runs eagerly during extension startup and its result is reused later in the same session.

## 2. Architecture

The integration is implemented entirely in `pi-extensions/extensions/claude-sync/`.

### High-level flow

1. Extension initialization starts a single `syncClaudeMappings(process.cwd())` promise.
2. The sync checks for two possible Claude sources:
   - **user scope**: `~/.claude` mapped into `~/.pi/agent`
   - **project scope**: nearest ancestor `.claude` mapped into that project's `.pi`
3. Each discovered source is processed by `syncClaudeTarget(...)`.
4. `syncClaudeTarget(...)`:
   - verifies or creates the destination Pi directory
   - links `skills` and `agents` as whole directories when they exist
   - maps `commands/**/*.md` into individual prompt symlinks under `prompts/`
   - accumulates created link paths and non-fatal issues
5. `resources_discover` waits for the startup sync promise before returning so Pi sees the mirrored resources.
6. `session_start` reports warnings and created-link counts through the UI when available, or `console.warn(...)` otherwise.

### Resource mapping model

The extension treats Claude resources differently depending on their shape:

- **`skills/`** → linked as `skills` directory
- **`agents/`** → linked as `agents` directory
- **`commands/**/_.md`** → linked one file at a time into `prompts/_.md`

Commands are not linked as a directory because Claude command naming uses nested paths, while Pi prompt discovery expects prompt files in a `prompts/` directory. The bridge therefore flattens nested command paths into colon-delimited filenames.

Example mappings:

- `~/.claude/skills` → `~/.pi/agent/skills`
- `repo/.claude/agents` → `repo/.pi/agents`
- `repo/.claude/commands/dev/reverse.md` → `repo/.pi/prompts/dev:reverse.md`

### Target discovery

User-scope discovery is fixed to the home directory. Project-scope discovery is relative to the current working directory and uses nearest-ancestor semantics:

- start from `path.resolve(process.cwd())`
- if the directory contains `.claude/`, that directory is the project root
- otherwise walk to the parent directory and repeat
- stop at filesystem root and return `null` if no `.claude` directory exists

This makes project sync sensitive to where Pi was launched, matching other workspace-scoped behaviors in the repo.

### Filesystem safety model

The integration is intentionally conservative.

#### Destination container checks

Before syncing a target, the extension verifies that the destination Pi root (`~/.pi/agent` or `<project>/.pi`) either:

- already exists as a directory, or
- can be created recursively.

If that path exists but is not a directory, the entire target is skipped with a warning.

For prompt syncing specifically, the `prompts/` directory also must be a directory or creatable. If `prompts` exists but is not a directory, prompt syncing is skipped for that target while any already-handled `skills` or `agents` work remains intact.

#### Symlink rules

`ensureSymlink(...)` only creates a symlink when the link path does not already exist. If the link path exists:

- a non-symlink path produces a warning and is left untouched
- a broken symlink produces a warning and is left untouched
- a symlink already pointing at the desired target is accepted as-is
- a symlink pointing somewhere else produces a warning and is left untouched

When a new link is created, the extension first ensures the parent directory exists, then writes a **relative** symlink target using `path.relative(...)`.

This keeps the bridge idempotent for the happy path while avoiding destructive "repair" behavior for ambiguous or user-managed paths.

### Command name translation

Claude commands are discovered by recursively enumerating markdown files under `commands/`, sorting them, removing the `.md` extension, and replacing path separators with `:`.

Examples:

- `commands/review.md` → `review.md`
- `commands/dev/reverse.md` → `dev:reverse.md`
- `commands/foo/bar/baz.md` → `foo:bar:baz.md`

If two distinct Claude command files map to the same prompt filename, the second one is skipped and a warning is recorded. Duplicate detection is per target sync pass.

### Lifecycle integration

The extension does not expose tools or commands. Its contract is lifecycle-based:

- **startup:** begin syncing immediately and memoize the promise
- **`resources_discover`:** await the promise so Pi resource discovery observes the synced files
- **`session_start`:** surface accumulated issues and created-link counts to the user

Because the promise is created once at extension initialization, both hooks observe the same sync result for the session.

## 3. Data Model

Result reporting is intentionally lightweight:

```ts
type Issue = {
	level: "warning" | "info";
	message: string;
};

type SyncTargetResult = {
	label: string;
	rootDir: string | null;
	claudeDir: string | null;
	created: string[];
	issues: Issue[];
};

type SyncResult = {
	targets: SyncTargetResult[];
};
```

`SyncTargetResult` is emitted once per discovered scope (`user` and/or `project`). It records:

- the target label
- the source root that contained `.claude`
- the concrete Claude directory used for syncing
- every symlink path created during this run
- every non-fatal issue encountered

This result is not persisted; it is used only to coordinate lifecycle behavior and user-facing notifications within the current session.

## 4. Interfaces

### Internal helper API

#### `findNearestClaudeRoot(startCwd: string): Promise<string | null>`

Walks upward from `startCwd` until a directory containing `.claude` is found.

Behavioral contract:

- returns the ancestor directory, not the `.claude` path itself
- returns `null` when no project Claude root exists
- only treats `.claude` as valid when it is a directory

#### `listMarkdownFilesRecursively(dir: string): Promise<string[]>`

Recursively discovers markdown command files below a Claude `commands/` directory.

Behavioral contract:

- traverses nested directories depth-first
- includes regular files and symlinked files ending in `.md`
- returns results sorted for deterministic processing order

#### `ensureDirectoryContainer(dirPath: string, issues: Issue[]): Promise<boolean>`

Ensures a path is usable as a directory container.

Behavioral contract:

- returns `true` when the path already exists as a directory
- creates the directory recursively and returns `true` when absent
- records a warning and returns `false` when a non-directory already occupies the path

#### `ensureSymlink({ linkPath, targetPath, created, issues }): Promise<void>`

Applies the integration's safe symlink policy.

Behavioral contract:

- creates a relative symlink when `linkPath` does not exist
- appends `linkPath` to `created` only for newly created links
- leaves existing correct symlinks unchanged
- records warnings instead of mutating conflicting or broken existing paths

### Sync API

#### `syncClaudeTarget({ label, claudeDir, piDir, rootDir }): Promise<SyncTargetResult>`

Synchronizes one source/destination pair.

Behavioral contract:

- ensures `piDir` exists as a directory before syncing resources
- links whole `skills` and `agents` directories only when they exist in `claudeDir`
- creates/uses `prompts/` only when `commands/` exists in `claudeDir`
- maps command files individually through `commandFileToPromptName(...)`
- returns accumulated issues rather than throwing for expected filesystem conflicts

#### `syncClaudeMappings(startCwd: string): Promise<SyncResult>`

Builds the set of sync targets for the current session.

Behavioral contract:

- includes a `user` target only when `~/.claude` exists as a directory
- includes a `project` target only when a nearest project Claude root is found
- may return zero, one, or two targets
- preserves target order as user first, project second

### Extension API contract

`export default function (pi: ExtensionAPI)` registers two lifecycle handlers:

- `resources_discover` — awaits the sync promise and returns an empty object
- `session_start` — reports issues and created-link counts through `ctx.ui.notify(...)` when `ctx.hasUI`, otherwise via `console.warn(...)`

The extension does not publish synced paths directly through the hook return value. Instead, it relies on the filesystem side effects being complete before Pi continues discovering resources.

## 5. Design Decisions

- **Decision:** Sync is implemented as symlink creation rather than file copying.
  - **Rationale:** Claude-authored resources remain the source of truth, and Pi sees updates through the linked filesystem view instead of maintaining a second copy.

- **Decision:** User and project scopes are both supported in one pass.
  - **Rationale:** Pi can consume personal Claude resources from `~/.claude` while also honoring repo-local Claude resources when launched inside a project hierarchy.

- **Decision:** `skills` and `agents` are linked as directories, but `commands` are mapped file-by-file into `prompts`.
  - **Rationale:** Pi directory conventions align with Claude for skills and agents, but command names need translation into Pi prompt filenames.

- **Decision:** Symlink targets are written as relative paths.
  - **Rationale:** Relative links remain portable when parent directories move together and are easier to inspect inside the destination tree.

- **Decision:** Conflicts are reported, not repaired.
  - **Rationale:** Existing files, broken links, and alternative symlink targets may reflect deliberate user state; the extension avoids destructive assumptions.

- **Decision:** Startup work is memoized in a single promise reused by both lifecycle hooks.
  - **Rationale:** Sync runs once per session, avoids duplicate filesystem work, and gives `resources_discover` and `session_start` a consistent view of the outcome.

## 6. Testing

There are currently no automated tests in this repo covering `pi-extensions/extensions/claude-sync/`.

Current validation is manual and static:

- running Pi from the repo exercises the extension because `package.json` exports `pi-extensions/extensions`
- `.pi/settings.json` points local Pi runs at the package root for development
- `npm run lint` and `npm run typecheck` provide static checks only

Important runtime behaviors that are currently verified by inspection rather than tests include:

- nearest-project `.claude` discovery
- duplicate command-name collision handling
- warning behavior for broken or conflicting symlinks
- UI vs non-UI notification paths

## 7. Open Questions

- Should the integration remove stale prompt symlinks when Claude command files are deleted or renamed?
- Should broken symlinks be automatically repaired when they can be unambiguously recreated?
- Should additional Claude resource categories ever be mapped into Pi, or is the current `skills` / `agents` / `commands` surface the intended long-term boundary?
- Should there be a manual re-sync trigger for long-lived sessions where Claude resources change after startup?

## Code Locations

- `pi-extensions/extensions/README.md`
- `pi-extensions/extensions/claude-sync/`
- `package.json` (extension export surface)
- `.pi/settings.json` (local development configuration that causes Pi to load this package from the repo root)
