# Devflow AFK automation commands.

use helpers.nu *

# Repeatedly run runnable AFK tasks for a feature until the queue is blocked, exhausted, or a runner fails.
export def main [
  feature: string@complete-features           # Feature name or active feature folder, e.g. `my-feature` or `devflow/feat/my-feature`
  study: string = ""                           # Additional context appended after the feature proposal/plan/spec context
  --agent: string = "main"                     # Pi agent to run (ignored when --claude is set)
  --model: string = ""                         # Model to run (defaults: pi=openai-codex/gpt-5.5:low, claude=sonnet)
  --session-id: string = ""                    # Original owner session to resume for final /flow-review--owner when all tasks complete
  --claude                                     # Use claude CLI instead of pi
] {
  let ctx = (run-context $feature $study $agent $model $session_id $claude)
  mut failures = 0
  mut loop_count = 0
  let max_failures = 3

  loop {
    let task = (next-task $ctx.task_index | str trim)
    if $task == "" {
      stop-line "afk loop stopped: no runnable tasks remain"
      break
    }

    $loop_count = ($loop_count + 1)
    let result = (run-task-cycle $ctx $task $loop_count)

    if not $result.ok {
      $failures = ($failures + 1)
      print $result.stderr

      if $loop_count == 1 {
        error make { msg: $"initial ($ctx.cli) run failed; aborting afk loop" }
      }

      error-line $"($ctx.cli) failed; retrying afk loop (($failures)/($max_failures))"
      if $failures >= $max_failures {
        error make { msg: $"($ctx.cli) failed ($max_failures) times in a row" }
      }

      continue
    }

    $failures = 0
    if $result.stop != "" {
      break
    }
  }

  maybe-run-owner-review $ctx
}
