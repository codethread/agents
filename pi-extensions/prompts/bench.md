---
description: Benchmark a task across multiple models/thinking levels
argument-hint: <task description>
---

# Benchmark Orchestration

You are orchestrating a benchmark run: spawning isolated Pi processes across git worktrees, then analyzing and comparing results.

## Configuration

Read `.pi/bench-matrix.json` for the run config. **If missing**, scaffold it interactively:

1. Ask the user which models/thinking levels to benchmark
2. Ask for the setup command if not obvious from the project (e.g., `pnpm install`)
3. Create the run's session directory, write the exact benchmark prompt to `prompt.md` inside it, and record that file path in the matrix
4. Write `.pi/bench-matrix.json` and add it to `.gitignore` if not already there

### Matrix schema

```json
{
	"setup": "pnpm install",
	"task": "Rewrite tmux-window-title extension in clean code style",
	"promptPath": "/home/codethread/.pi/agent/bench-sessions/2026-04-13T14-30-00/prompt.md",
	"lastRun": null,
	"entries": {
		"sonnet-high": {
			"model": "github-copilot/claude-sonnet-4.6",
			"thinking": "high",
			"batchId": 1
		},
		"gpt5": {
			"model": "openai-codex/gpt-5.4",
			"thinking": "off",
			"batchId": 1
		},
		"gpt5-mini": {
			"model": "openai-codex/gpt-5.4-mini",
			"thinking": "off",
			"batchId": 2
		}
	}
}
```

| Field                     | Description                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `setup`                   | Shell command run in each new worktree before benchmarking                                          |
| `task`                    | Original user request / benchmark task description                                                  |
| `promptPath`              | Path to the markdown file containing the exact benchmark prompt; `cat` it into Pi for each run      |
| `lastRun`                 | `null` for fresh state, or `"<run-id>"` after a completed run (task is stored at top-level `task`)  |
| `entries.<slug>`          | Short descriptive key, used as worktree/branch suffix                                               |
| `entries.<slug>.model`    | Pi `--model` value                                                                                  |
| `entries.<slug>.thinking` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`                                  |
| `entries.<slug>.batchId`  | Optional, defaults to `1`. Same batchId = parallel. Batches execute sequentially in ascending order |

### Batch execution

Entries with the same `batchId` (or missing, defaulting to `1`) launch in parallel. Batches execute in ascending numerical order. Example:

- `batchId: 1` and missing `batchId` → first wave (parallel)
- `batchId: 2` → second wave (after batch 1 completes)

## State machine

### `lastRun` is null or missing → New run

Proceed to **New Run**.

### `lastRun` is present

Compare top-level `task` to the user's current request:

- **Match or user asks for analysis** → Skip to **Analysis**
- **Match and user asks for additional models / another benchmark pass** → Skip to **Additional Run**
- **Clearly different task** → Treat as stale. Clear `lastRun`, proceed to **New Run**

If ambiguous, ask the user.

## Subagent Policy

When constructing the benchmark prompt for each spawned Pi process, decide subagent delegation policy from task intent:

- **Direct skill tasks** (e.g., "rewrite this code", "add tests", "refactor this module"): append:
  - `Do all the work yourself directly. Do NOT delegate to subagents.`
  - Rationale: benchmark the model's own implementation ability.
- **Orchestration tasks** (e.g., "implement this feature across 5 modules", "coordinate a migration"): allow subagents freely.
  - Rationale: benchmark coordination and delegation quality.
- **Nuanced cases**: some subagents are useful without doing implementation work. `scout` is generally acceptable even in direct-skill benchmarks for reconnaissance. Consider appending:
  - `Do NOT delegate implementation work to subagents. You may use the scout agent for codebase exploration if needed.`

This policy decision belongs to the orchestrating agent at prompt-construction time, not the matrix configuration. The matrix defines model/thinking permutations; the orchestrator interprets task intent.

If the user explicitly specifies subagent policy in their `/bench` request, that explicit instruction overrides this heuristic.

## New Run

### 1. Generate run ID

Use an ISO timestamp slug: `2026-04-13T14-30-00`

### 2. Create the session dir and prompt file

```bash
RUN_ID="<run-id>"
SESSION_DIR="$HOME/.pi/agent/bench-sessions/$RUN_ID"
PROMPT_FILE="$SESSION_DIR/prompt.md"
mkdir -p "$SESSION_DIR"
cat > "$PROMPT_FILE" <<'EOF'
<the rendered benchmark prompt markdown>
EOF
```

The prompt now lives in the run's session directory, which makes it easy to inspect later and avoids escaping issues. Store that file path in `.pi/bench-matrix.json` as `promptPath`.

### 3. Create worktrees and install deps

```bash
# Create worktrees for all matrix entries
for slug in <slugs>; do
  git worktree add "../<repo>__bench-$slug" -b "bench-$slug"
done

# Run setup in each
for slug in <slugs>; do
  cd /path/to/<repo>__bench-$slug && <setup-command>
done
```

The repo name comes from the current worktree's directory basename (without any existing `__suffix`). Use `git worktree list` to find the base path.

### 4. Execute batches

Group entries by `batchId` (defaulting to `1`). For each batch in ascending order, launch all entries in that batch as parallel background processes:

```bash
PROMPT_FILE="$(jq -r '.promptPath' .pi/bench-matrix.json)"
SESSION_DIR="$(dirname "$PROMPT_FILE")"
RUN_ID="$(basename "$SESSION_DIR")"
LOG_DIR="/tmp/bench-$RUN_ID"
mkdir -p "$LOG_DIR"

# Launch batch (all entries with same batchId)
for slug in <batch-slugs>; do
  read -r model thinking <<< "<model> <thinking>"  # from matrix
  wt_dir="/path/to/<repo>__bench-$slug"
  (
    cd "$wt_dir" && \
    cat "$PROMPT_FILE" | pi --print \
      --model "$model" \
      --thinking "$thinking" \
      --session "$SESSION_DIR/$slug.jsonl" \
      > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
    echo $? > "$LOG_DIR/$slug.exit"
  ) &
done
wait
```

Capture stdout/stderr/exit-code per entry so you can diagnose failures.

### 5. Monitor running batches

TODO: can we make this a file watch or process watch to be deterministic? It's valid to be able to check the status as a heartbeat if we hit a global timeout (30mins for a full bench is good, as these runs can be slow, so we'd want to double check things are ticking along, then set another watch process with 30 min timeout)

While processes are running, poll status:

```bash
for slug in <all-slugs>; do
  exit_file="$LOG_DIR/$slug.exit"
  session_file="$SESSION_DIR/$slug.jsonl"
  if [ -f "$exit_file" ]; then
    echo "✅ $slug: done (exit=$(cat $exit_file))"
  elif [ -f "$session_file" ]; then
    turns=$(jq -r 'select(.type == "message" and .message.role == "assistant") | .message.role' "$session_file" | wc -l)
    echo "⏳ $slug: running (~${turns} turns)"
  else
    echo "⏳ $slug: starting..."
  fi
done
```

### 6. Update state

Populate top-level `task` from the user's request and set `promptPath` to the run's `prompt.md` file, then set `lastRun` in `.pi/bench-matrix.json`:

```json
{
	"task": "<the user's request>",
	"promptPath": "<absolute path to session-dir/prompt.md>",
	"lastRun": "<run-id>"
}
```

### 7. Proceed to Analysis

## Additional Run

Use when the benchmark task is unchanged, but the user wants to expand the matrix with one or more new model/thinking combinations and run only those additions.

### 1. Add the missing entries

Read `.pi/bench-matrix.json` and append new `entries` for the requested model/thinking pairs that do not already exist. Leave existing entries unchanged.

### 2. Generate a run ID

Use an ISO timestamp slug: `2026-04-13T14-30-00`

### 3. Create the session dir and prompt file

```bash
RUN_ID="<run-id>"
SESSION_DIR="$HOME/.pi/agent/bench-sessions/$RUN_ID"
PROMPT_FILE="$SESSION_DIR/prompt.md"
mkdir -p "$SESSION_DIR"
cat > "$PROMPT_FILE" <<'EOF'
<the rendered benchmark prompt markdown>
EOF
```

The new run gets its own session directory and `prompt.md`, so old runs keep their historical prompt file intact.

### 4. Create worktrees and install deps for the new entries only

```bash
# Create worktrees only for the new slugs
for slug in <new-slugs>; do
  git worktree add "../<repo>__bench-$slug" -b "bench-$slug"
done

# Run setup in each new worktree
for slug in <new-slugs>; do
  cd /path/to/<repo>__bench-$slug && <setup-command>
done
```

The existing matrix entries and their worktrees are left alone. New entries can reuse or define `batchId` values among themselves for parallelism; only the new entries are scheduled.

### 5. Execute batches

Group only the new entries by `batchId` (defaulting to `1`). For each batch in ascending order, launch all entries in that batch as parallel background processes.

### 6. Update state

Populate top-level `task` from the user's request and set `promptPath` to the run's `prompt.md` file, then set `lastRun` in `.pi/bench-matrix.json` to the new run ID:

```json
{
	"task": "<the user's request>",
	"promptPath": "<absolute path to session-dir/prompt.md>",
	"lastRun": "<run-id>"
}
```

### 7. Proceed to Analysis

## Analysis

Use the `pi-session-introspection` skill to analyze `~/.pi/agent/bench-sessions/<run-id>/` session files.

Inspect the source code yourself as appropriate to measure quality based on the user's original request.

Note: Some providers (github-copilot) do not report cost, this does not mean the model is free, we must simply infer usage from tokens alone

### Per-entry metrics

```bash
SESSION="$SESSION_DIR/$slug.jsonl"

# Cost and turns
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") |
  .message.usage.cost.total] | {cost_usd: (add | . * 10000 | round / 10000), turns: length}' "$SESSION"

# Token totals
jq -s '[.[] | select(.type == "message" and .message.role == "assistant") | .message.usage] |
  {total_input: (map(.input) | add), total_output: (map(.output) | add),
   total_cache_read: (map(.cacheRead // 0) | add)}' "$SESSION"

# Tool call breakdown
jq -r 'select(.type == "message" and .message.role == "assistant") |
  .message.content[] | select(.type == "toolCall") | .name' "$SESSION" |
  sort | uniq -c | sort -rn

# Duration (wall-clock from first to last message timestamp)
first=$(jq -r 'select(.type == "message") | .timestamp' "$SESSION" | head -1)
last=$(jq -r 'select(.type == "message") | .timestamp' "$SESSION" | tail -1)

# Tool errors
jq -s '[.[] | select(.type == "message" and .message.role == "toolResult" and
  .message.isError == true)] | length' "$SESSION"
```

### Per-worktree checks

```bash
# File structure
cd /path/to/<repo>__bench-$slug
tree --charset=ascii <target-dir>/

# Git diff stats
git diff --stat HEAD

# Project verification
pnpm check  # or whatever the project uses

# Carry out analysis, such as additional tests written
pnpm test 2>&1 | rg '(Test Files|Tests)'
```

Present results as a **comparison table**. Include all metrics side-by-side. Then ask the user what to do next.

### Resetting a single entry for re-run

```bash
# Reset worktree to clean state
cd /path/to/<repo>__bench-$slug && git checkout -- . && git clean -fd
# Remove stale session
rm -f "$SESSION_DIR/$slug.jsonl"
# Re-run with the same or modified prompt
```

## Cleanup

When the user explicitly states the bench as done:

```bash
for slug in <all-slugs>; do
  git worktree remove "../<repo>__bench-$slug"
  git branch -D "bench-$slug"
done
```

Clear `lastRun` from `.pi/bench-matrix.json`. Session files in `~/.pi/agent/bench-sessions/<run-id>/` can be kept for future reference.

## Task

$ARGUMENTS
