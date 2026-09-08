# Devflow AFK automation commands.

use helpers.nu *

# Run one AFK cycle for a specific task id from a feature queue.
export def main [
  feature: string@complete-features           # Feature name or active feature folder, e.g. `my-feature` or `devflow/feat/my-feature`
  task_id: string                              # Task id from tasks/index.yml to run
  study: string = ""                           # Additional context appended after the feature proposal/plan/spec context
  --agent: string = "main"                     # Pi agent to run (ignored when --claude is set)
  --model: string = ""                         # Model to run (defaults: pi=openai-codex/gpt-5.5:low, claude=sonnet)
  --session-id: string = ""                    # Original owner session to resume for final /flow-review--owner when all tasks complete
  --claude                                     # Use claude CLI instead of pi
] {
  let ctx = (run-context $feature $study $agent $model $session_id $claude)
  let task = (task-by-id $ctx.task_index $task_id | str trim)
  let result = (run-task-cycle $ctx $task 1)
  if not $result.ok {
    print $result.stderr
    error make { msg: $"($ctx.cli) run failed" }
  }

  maybe-run-owner-review $ctx
}
