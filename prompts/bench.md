---
description: Benchmark a task across models, prompts, or both
argument-hint: <task description>
---

# Benchmark Orchestration

You are orchestrating a benchmark run: spawning isolated agent/tool processes across git worktrees, then analyzing and comparing results.

The system supports three shapes through the same core flow:

- **One prompt → many models/thinking levels**
- **One model → many prompts**
- **Many prompts × many models** (cross-product)

Every runnable unit is an `entry`. Every entry gets its own worktree, session file, and batch slot. Analysis compares entries side-by-side.

## Configuration

Read `.pi/bench-matrix.json` for the run config. **If missing**, scaffold it interactively:

1. Ask the user which axis to compare: models, prompts, or both
2. Collect model/thinking combinations and prompt variant(s)
3. Ask for the setup command if not obvious from the project (e.g. `pnpm install`)
4. Create the run's session directory, write prompt file(s), record paths in the matrix
5. Write `.pi/bench-matrix.json` and add it to `.gitignore` if not already there

### Matrix schema

A single unified schema. Each entry resolves to exactly one runner/tool, one prompt, and the runner-specific config needed to execute it. The varying axis is inferred from how entries differ — no `mode` field.

```json
{
	"setup": "pnpm install",
	"task": "Rewrite tmux-window-title extension in clean code style",
	"prompts": {
		"baseline": {
			"path": "/home/codethread/.pi/agent/bench-sessions/2026-04-13T14-30-00/prompts/baseline.md"
		},
		"strict": {
			"path": "/home/codethread/.pi/agent/bench-sessions/2026-04-13T14-30-00/prompts/strict.md"
		}
	},
	"lastRun": null,
	"entries": {
		"pi-gpt5-baseline": {
			"tool": "pi",
			"model": "openai-codex/gpt-5.4",
			"thinking": "off",
			"prompt": "baseline",
			"batchId": 1
		},
		"claude-sonic-baseline": {
			"tool": "claude",
			"model": "sonic",
			"thinking": "high",
			"prompt": "baseline",
			"batchId": 1
		},
		"codex-baseline": {
			"tool": "codex",
			"prompt": "baseline",
			"batchId": 1
		}
	}
}
```

When `prompts` contains exactly one entry, `entries.<slug>.prompt` can be omitted — the single prompt is used implicitly. When multiple prompts exist, every entry must specify `prompt`.

### Runner-specific entry fields

- `tool: "pi"`
  - Requires `model`
  - Optional `thinking`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
- `tool: "claude"`
  - Command shape: `claude --print --dangerously-skip-permissions`
  - Supports prompt via stdin
  - Optional `model`: if omitted, default to `sonic`; user may instead request `haiku` or `opus`
  - Optional `thinking`: use this value for Claude's `--effort` flag
  - Claude `thinking` values should match Claude effort levels: `low`, `medium`, `high`, `xhigh`, `max`
- `tool: "codex"`
  - Command shape: `codex exec --dangerously-bypass-approvals-and-sandbox`
  - Supports prompt via stdin
  - Do not vary thinking: use Codex's default GPT-5.4 high-thinking behavior
  - Optional `model` only if the user explicitly wants to override it

| Field                     | Description                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `setup`                   | Shell command run in each new worktree before benchmarking                                      |
| `task`                    | Original user request / benchmark task description                                              |
| `prompts.<slug>.path`     | Absolute path to a prompt variant's markdown file                                               |
| `lastRun`                 | `null` for fresh state, or `"<run-id>"` after a completed run                                   |
| `entries.<slug>`          | Runnable benchmark unit; slug is the worktree/branch/session suffix                             |
| `entries.<slug>.tool`     | Runner/tool: `pi`, `claude`, or `codex`                                                         |
| `entries.<slug>.model`    | Runner-specific model value; required for Pi, optional for Claude/Codex as described above      |
| `entries.<slug>.thinking` | Pi thinking level, or for Claude the value passed to `--effort`                                 |
| `entries.<slug>.prompt`   | Key into `prompts`; required when multiple prompts exist                                        |
| `entries.<slug>.batchId`  | Optional, defaults to `1`. Same batchId = parallel. Batches run sequentially in ascending order |

### Cross-product

When the user wants multiple prompts × multiple models, expand into explicit entries. Example: 2 prompts × 3 models = 6 entries. Persist the expanded set — this makes batching, re-runs, and analysis deterministic.

### Batch execution

Entries with the same `batchId` (or missing, defaulting to `1`) launch in parallel. Batches execute in ascending order. Batching is at the **entry** level: two entries sharing a model but using different prompts are still separate entries with independent batch slots.

## State machine

### `lastRun` is null or missing → New run

Proceed to **New Run**.

### `lastRun` is present

Compare top-level `task` to the user's current request:

- **Match or user asks for analysis** → Skip to **Analysis**
- **Match and user asks to add models, prompts, or both** → Skip to **Additional Run**
- **User wants to revise prompt wording** → Create a new prompt slug + new entries, then **Additional Run**
- **Clearly different task** → Treat as stale. Clear `lastRun`, proceed to **New Run**

If ambiguous, ask the user.

## Subagent Policy

When constructing the benchmark prompt for each spawned process, decide delegation policy from task intent:

- **Direct skill tasks** (e.g. "rewrite this code", "add tests", "refactor this module"): append:
  - `Do all the work yourself directly. Do NOT delegate to subagents.`
- **Orchestration tasks** (e.g. "implement this feature across 5 modules", "coordinate a migration"): allow subagents freely.
- **Nuanced cases**: `scout` is generally acceptable even in direct-skill benchmarks. Consider:
  - `Do NOT delegate implementation work to subagents. You may use the scout agent for codebase exploration if needed.`

This policy belongs to the orchestrating agent at prompt-construction time. The matrix defines permutations; the orchestrator interprets task intent.

Apply this policy only to **Pi** entries. For **Claude** and **Codex**, do not add extra session-inspection instructions or Pi-specific harness guidance — just give them the benchmark task and evaluate the resulting code/output.

If the user explicitly specifies subagent policy, that overrides this heuristic.

## New Run

### 1. Generate run ID

ISO timestamp slug: `2026-04-13T14-30-00`

### 2. Create session dir and prompt files

```bash
RUN_ID="<run-id>"
SESSION_DIR="$HOME/.pi/agent/bench-sessions/$RUN_ID"
PROMPTS_DIR="$SESSION_DIR/prompts"
mkdir -p "$PROMPTS_DIR"

cat > "$PROMPTS_DIR/<prompt-slug>.md" <<'EOF'
<the rendered prompt variant markdown>
EOF
```

One file per prompt variant. Use descriptive slugs: `baseline`, `strict`, `minimal-context`. Update `prompts.<slug>.path` in the matrix to point here. The written file is the source of truth — do not paraphrase or regenerate later.

### 3. Create worktrees and install deps

```bash
for slug in <slugs>; do
  git worktree add "../<repo>__bench-$slug" -b "bench-$slug"
done

for slug in <slugs>; do
  cd /path/to/<repo>__bench-$slug && <setup-command>
done
```

Each entry gets its own worktree. The repo name comes from the current worktree's directory basename (without any `__suffix`). Use `git worktree list` to find the base path.

### 4. Execute batches

Group entries by `batchId` (default `1`). For each batch in ascending order, launch all entries as parallel background processes.

Prompt resolution:

- If the entry has `prompt`, use `prompts[that-key].path`
- Otherwise, use the single prompt in `prompts`

Execution policy by runner:

- **Pi**: use `pi --print`, persist a JSONL session file, and later inspect both result and session internals
- **Claude**: use `claude --print --dangerously-skip-permissions`, pipe prompt on stdin, capture stdout/stderr/exit only, and evaluate the result only
- **Codex**: use `codex exec --dangerously-bypass-approvals-and-sandbox`, pipe prompt on stdin, capture stdout/stderr/exit only, and evaluate the result only

```bash
SESSION_DIR="$HOME/.pi/agent/bench-sessions/$RUN_ID"
LOG_DIR="/tmp/bench-$RUN_ID"
mkdir -p "$LOG_DIR"

resolve_prompt() {
  jq -r --arg slug "$1" '
    .entries[$slug] as $entry
    | if ($entry.prompt // "") != "" then
        .prompts[$entry.prompt].path
      else
        .prompts[(.prompts | keys[0])].path
      end
  ' .pi/bench-matrix.json
}

for slug in <batch-slugs>; do
  tool="$(jq -r --arg s "$slug" '.entries[$s].tool // "pi"' .pi/bench-matrix.json)"
  model="$(jq -r --arg s "$slug" '.entries[$s].model // ""' .pi/bench-matrix.json)"
  thinking="$(jq -r --arg s "$slug" '.entries[$s].thinking // ""' .pi/bench-matrix.json)"
  prompt_file="$(resolve_prompt "$slug")"
  wt_dir="/path/to/<repo>__bench-$slug"
  (
    cd "$wt_dir" || exit 1
    case "$tool" in
      pi)
        cat "$prompt_file" | pi --print \
          --model "$model" \
          ${thinking:+--thinking "$thinking"} \
          --session "$SESSION_DIR/$slug.jsonl" \
          > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
        ;;
      claude)
        if [ -n "$model" ]; then
          cat "$prompt_file" | claude --print --dangerously-skip-permissions --model "$model" ${thinking:+--effort "$thinking"} \
            > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
        else
          cat "$prompt_file" | claude --print --dangerously-skip-permissions --model sonic ${thinking:+--effort "$thinking"} \
            > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
        fi
        ;;
      codex)
        if [ -n "$model" ]; then
          cat "$prompt_file" | codex exec --dangerously-bypass-approvals-and-sandbox --model "$model" - \
            > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
        else
          cat "$prompt_file" | codex exec --dangerously-bypass-approvals-and-sandbox - \
            > "$LOG_DIR/$slug.stdout" 2> "$LOG_DIR/$slug.stderr"
        fi
        ;;
      *)
        echo "Unknown tool: $tool" >&2
        exit 1
        ;;
    esac
    echo $? > "$LOG_DIR/$slug.exit"
  ) &
done
# Do NOT `wait` here — step 5 handles the unified wait across all batches
```

### 5. Wait for completion

Block until all entries finish, with a 30-minute heartbeat checkpoint. Do **not** return control to the agent between polls — the script itself handles the wait loop so no agent turns are wasted.

```bash
SLUGS="<all-slugs>"
TIMEOUT=1800  # 30 minutes
start=$(date +%s)

while true; do
  done_count=0
  total=0
  for slug in $SLUGS; do
    total=$((total + 1))
    [ -f "$LOG_DIR/$slug.exit" ] && done_count=$((done_count + 1))
  done
  [ $done_count -eq $total ] && break

  elapsed=$(( $(date +%s) - start ))
  if [ $elapsed -ge $TIMEOUT ]; then
    echo "=== 30-minute heartbeat ($done_count/$total done) ==="
    for slug in $SLUGS; do
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
    start=$(date +%s)  # reset timer for next checkpoint
  fi

  sleep 5
done

echo "All entries completed."
for slug in $SLUGS; do
  echo "$slug: exit=$(cat $LOG_DIR/$slug.exit)"
done
```

This blocks the agent's bash call until all entries are done. The 5-second poll is negligible overhead. If 30 minutes pass with entries still running, it prints a status heartbeat and resets the timer — the agent only regains control when everything finishes or a bash timeout is hit.

### 6. Update state

Set `lastRun` and ensure prompt paths point to this run's session directory:

```json
{
	"task": "<the user's request>",
	"prompts": { "<slug>": { "path": "<session-dir/prompts/slug.md>" } },
	"lastRun": "<run-id>"
}
```

### 7. Proceed to Analysis

## Additional Run

Use when the task is unchanged but the user wants to expand the matrix — new models, new prompts, or new combinations.

### 1. Add missing prompts and entries

- Add new prompt variants under `prompts`
- Add new entries for requested model/thinking/prompt combinations
- Leave existing entries and prompt slugs unchanged
- Never overwrite an existing prompt slug; create a new one instead

### 2. Generate run ID

### 3. Create session dir and prompt files

Write all active prompt variants into the new run's `prompts/` directory. Each run is self-contained. Old runs keep their historical files.

### 4. Create worktrees for new entries only

### 5. Execute new entries only

Same prompt resolution and batch logic as New Run.

### 6. Update state

Update `lastRun` and prompt paths to the new run directory.

### 7. Proceed to Analysis

## Analysis

Inspect the source code in each worktree to measure quality against the user's original request.

For **Pi** entries, use the `pi-session-introspection` skill to analyze `~/.pi/agent/bench-sessions/<run-id>/` session files.

For **Claude** and **Codex** entries, do **not** inspect internal transcripts, agent logs, or hidden reasoning even if artifacts exist. Treat them as black-box runs: evaluate only the produced diff, stdout/stderr, exit code, and verification results.

Note: Some providers (github-copilot) do not report cost — infer usage from tokens alone.

### Framing

Frame the comparison according to what varies:

- **Model varies, prompt constant**: compare raw model performance.
- **Prompt varies, model constant**: compare how wording affects quality, instruction-following, scope control, tool usage, and code churn.
- **Both vary**: compare prompts within each model, then models within each prompt. Call out interaction effects. Do not flatten into one ranking.

### Per-entry metrics

Common to all runners:

- exit code
- wall-clock duration
- stdout/stderr summary
- diff stats
- verification results (`pnpm check` or project equivalent)
- qualitative notes on correctness, scope control, code quality, and instruction-following

Pi-only session metrics:

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

Claude/Codex black-box metrics:

```bash
wc -lc "$LOG_DIR/$slug.stdout" "$LOG_DIR/$slug.stderr"
head -50 "$LOG_DIR/$slug.stdout"
head -50 "$LOG_DIR/$slug.stderr"
```

### Per-worktree checks

```bash
cd /path/to/<repo>__bench-$slug
tree --charset=ascii <target-dir>/
git diff --stat HEAD
pnpm check  # or project verification command
```

### Presenting results

Comparison table with columns: slug, tool, model, thinking, prompt, exit code, duration, turns (Pi-only), tokens in/out (Pi-only if available), cost (Pi-only if available), diff stats, verification outcome, qualitative notes. For Claude, `thinking` is passed to `--effort`.

Interpret results according to the active comparison axis. Then ask the user what to do next.

### Write analysis to session directory

After presenting results to the user, write an `analysis.md` file to the run's session directory (`$SESSION_DIR/analysis.md`) containing the comparison table and summary. This is the permanent record of the run.

### Resetting a single entry

```bash
cd /path/to/<repo>__bench-$slug && git checkout -- . && git clean -fd
rm -f "$SESSION_DIR/$slug.jsonl"
```

To change prompt wording for comparison, create a new prompt slug and new entry rather than mutating history.

## Cleanup

When the user says the bench is done:

```bash
for slug in <all-slugs>; do
  git worktree remove "../<repo>__bench-$slug"
  git branch -D "bench-$slug"
done
```

Clear `lastRun` from `.pi/bench-matrix.json`. Session files in `~/.pi/agent/bench-sessions/<run-id>/` are kept for reference.

## Task

$ARGUMENTS
