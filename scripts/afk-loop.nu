# Repeatedly run the /afk prompt until the queue is blocked or exhausted.
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
  study: string                                # Text appended after `/afk study `: task entry point plus specs/context to read
  --agent: string = "main"                     # Pi agent to run
  --model: string = "openai-codex/gpt-5.5:low" # Pi model to run
] {
  mut pi_failures = 0
  mut loop_count = 0
  let max_pi_failures = 3
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
    let prompt = $"/afk study ($study)\n\nSelected task:\n($task)\n\nTask notes file: ($task_notes)"
    print $"running: /afk with next task from ($task_index) as ($session_name)"

    let res = (
      pi --agent $agent --model $model --name $session_name -p $prompt | complete
    )

    if $res.exit_code != 0 {
      $pi_failures = ($pi_failures + 1)
      print $res.stderr
      print $"pi failed; retrying afk loop (($pi_failures)/($max_pi_failures))"

      if $pi_failures >= $max_pi_failures {
        error make { msg: $"pi failed ($max_pi_failures) times in a row" }
      }

      continue
    }

    let out = ($res.stdout | str trim)
    print $out

    if (has-token $out "BLOCKED") {
      $pi_failures = 0
      print "afk loop stopped: task blocked"
      break
    }

    if (has-token $out "NO_TASKS_REMAIN") {
      $pi_failures = 0
      print "afk loop stopped: no runnable tasks remain"
      break
    }

    # likely success
    print $"running: refine"
    let refine = (pi -c -p "/refine" | complete)
    if $refine.exit_code != 0 {
      print $refine.stderr
      error make { msg: "refine failed" }
    }
    print ($refine.stdout | str trim)

    print $"running: smoke"
    let smoke = (pi -c -p "/smoke" | complete)
    if $smoke.exit_code != 0 {
      print $smoke.stderr
      error make { msg: "smoke failed" }
    }
    print ($smoke.stdout | str trim)

    let git_status = (git status --porcelain)
    if ($git_status | str trim) != "" {
      print "running: afk-finalise"
      print (git status --short)

      let finalise = (pi -c -p "/afk-finalise" | complete)
      if $finalise.exit_code != 0 {
        print $finalise.stderr
        error make { msg: "afk-finalise failed" }
      }

      let finalise_out = ($finalise.stdout | str trim)
      print $finalise_out

      let final_status = (git status --porcelain)
      if ($final_status | str trim) != "" {
        print "afk loop stopped: afk-finalise left uncommitted work"
        print (git status --short)
        error make { msg: "afk-finalise left uncommitted work" }
      }

      if (has-token $finalise_out "BLOCKED") {
        $pi_failures = 0
        print "afk loop stopped: finalise blocked"
        break
      }

      if (has-token $finalise_out "NO_TASKS_REMAIN") {
        $pi_failures = 0
        print "afk loop stopped: no runnable tasks remain"
        break
      }
    }

    $pi_failures = 0
  }
}
