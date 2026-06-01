# Repeatedly run the /flow-init--afk prompt until the queue is blocked or exhausted.
#
# Example:
#   use /Users/codethread/dev/projects/agents/scripts/afk-loop.nu
#   afk-loop "@tasks/index.yml, task files under @tasks/, ALL @specs/README.md and @UBIQUITOUS_LANGUAGE.md"

def has-token [out: string, token: string] {
  $out == $token or ($out | str contains $token)
}

def task-index-path [study: string] {
  $study | split row "," | first | str trim | str replace --regex "^@" ""
}

def task-items [task_index: string] {
  (open $task_index).tasks
}

def validate-task-index [items: table] {
  let ids = ($items | get id)
  let unknown_blockers = (
    $items
    | each {|task| $task.blocked_by | where {|id| $id not-in $ids} }
    | flatten
    | uniq
  )

  if ($unknown_blockers | length) > 0 {
    error make { msg: $"task index has unknown blocked_by ids: ($unknown_blockers | str join ', ')" }
  }

  let in_progress_count = ($items | where status == "in_progress" | length)
  if $in_progress_count > 1 {
    error make { msg: $"task index has multiple in_progress tasks: ($in_progress_count)" }
  }
}

def next-task [task_index: string] {
  let items = (task-items $task_index)
  validate-task-index $items

  let complete = ($items | where status == "complete" | get id)
  let in_progress = ($items | where status == "in_progress" | sort-by id)

  if ($in_progress | length) > 0 {
    $in_progress | first | to yaml
  } else {
    let pending = (
      $items
      | where {|task|
        ($task.status == "pending") and ((($task.blocked_by? | default []) | where {|id| $id not-in $complete} | length) == 0)
      }
      | sort-by id
    )

    if ($pending | length) > 0 {
      $pending | first | to yaml
    } else {
      ""
    }
  }
}

def task-status [task: string] {
  ($task | from yaml).status
}

def task-session-name [task: string, loop_count: int] {
  let task = ($task | from yaml)
  let id = $task.id
  let description = (
    $task.description
    | str trim
    | str replace --all --regex "\\s+" " "
    | str replace --all --regex "[^A-Za-z0-9._ -]" "-"
  )

  $"afk-($loop_count)-($id)-($description)"
}

export def main [
  study: string                                # Text appended after `/flow-init--afk study `: task entry point plus specs/context to read
  --agent: string = "main"                     # Pi agent to run (ignored when --claude is set)
  --model: string = ""                         # Model to run (defaults: pi=openai-codex/gpt-5.5:low, claude=sonnet)
  --claude                                     # Use claude CLI instead of pi
] {
  let effective_model = if $model == "" {
    if $claude { "sonnet" } else { "openai-codex/gpt-5.5:low" }
  } else {
    $model
  }
  let cli = if $claude { "claude" } else { "pi" }

  mut failures = 0
  mut loop_count = 0
  let max_failures = 3
  let task_index = (task-index-path $study)
  let task_notes = (($task_index | path dirname) | path join "README.md")

  loop {
    let task = (next-task $task_index | str trim)
    if $task == "" {
      print "afk loop stopped: no runnable tasks remain"
      break
    }

    let dirty_status = (git status --porcelain | str trim)
    if $dirty_status != "" and (task-status $task) != "in_progress" {
      print "afk loop stopped: uncommitted work before starting pending task"
      print (git status --short)
      error make { msg: "uncommitted work before pending task" }
    }

    $loop_count = ($loop_count + 1)
    let session_name = (task-session-name $task $loop_count)
    let prompt = $"/devflow:flow-init--afk study ($study)\n\nSelected task:\n($task)\n\nTask notes file: ($task_notes)"
    print $"running: /flow-init--afk with next task from ($task_index) as ($session_name)"

    let res = if $claude {
      $prompt | claude --print --dangerously-skip-permissions --model $effective_model --name $session_name | complete
    } else {
      pi --agent $agent --model $effective_model --name $session_name -p $prompt | complete
    }

    if $res.exit_code != 0 {
      $failures = ($failures + 1)
      print $res.stderr
      print $"($cli) failed; retrying afk loop (($failures)/($max_failures))"

      if $failures >= $max_failures {
        error make { msg: $"($cli) failed ($max_failures) times in a row" }
      }

      continue
    }

    let out = ($res.stdout | str trim)
    print $out

    if (has-token $out "BLOCKED") {
      $failures = 0
      print "afk loop stopped: task blocked"
      break
    }

    if (has-token $out "NO_TASKS_REMAIN") {
      $failures = 0
      print "afk loop stopped: no runnable tasks remain"
      break
    }

    # likely success
    print $"running: flow-build--refine"
    let refine = if $claude {
      "/flow-build--refine" | claude --print --dangerously-skip-permissions -c | complete
    } else {
      pi -c -p "/flow-build--refine" | complete
    }
    if $refine.exit_code != 0 {
      print $refine.stderr
      error make { msg: "refine failed" }
    }
    print ($refine.stdout | str trim)

    print $"running: flow-build--smoke"
    let smoke = if $claude {
      "/flow-build--smoke" | claude --print --dangerously-skip-permissions -c | complete
    } else {
      pi -c -p "/flow-build--smoke" | complete
    }
    if $smoke.exit_code != 0 {
      print $smoke.stderr
      error make { msg: "smoke failed" }
    }
    print ($smoke.stdout | str trim)

    let git_status = (git status --porcelain)
    if ($git_status | str trim) != "" {
      print "running: flow-build--finalise"
      print (git status --short)

      let finalise = if $claude {
        "/flow-build--finalise" | claude --print --dangerously-skip-permissions -c | complete
      } else {
        pi -c -p "/flow-build--finalise" | complete
      }
      if $finalise.exit_code != 0 {
        print $finalise.stderr
        error make { msg: "flow-build--finalise failed" }
      }

      let finalise_out = ($finalise.stdout | str trim)
      print $finalise_out

      let final_status = (git status --porcelain)
      if ($final_status | str trim) != "" {
        print "afk loop stopped: flow-build--finalise left uncommitted work"
        print (git status --short)
        error make { msg: "flow-build--finalise left uncommitted work" }
      }

      if (has-token $finalise_out "BLOCKED") {
        $failures = 0
        print "afk loop stopped: finalise blocked"
        break
      }

      if (has-token $finalise_out "NO_TASKS_REMAIN") {
        $failures = 0
        print "afk loop stopped: no runnable tasks remain"
        break
      }
    }

    $failures = 0
  }
}
