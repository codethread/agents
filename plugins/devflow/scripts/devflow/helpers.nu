# Shared helpers for devflow AFK automation commands.

# Reference shape for ctx records, written as if Nushell supported named type aliases:
# type RunContext = record<
#   active_feature_dir: string, # Active feature folder, e.g. devflow/feat/my-feature
#   feature_name: string,       # Basename of active_feature_dir
#   proposal_file: string,      # Feature proposal path
#   task_index: string,         # Feature task index path
#   feature_plan: string,       # Feature plan path
#   study: string,              # Additional context passed to AFK prompt
#   agent: string,              # Pi agent name when using Pi
#   effective_model: string,    # Resolved model for Pi or Claude
#   session_id: string,         # Owner session id for final review, or empty
#   claude: bool,               # Whether to use Claude CLI instead of Pi
#   cli: string                 # Display name for selected CLI
# >

export def run-context [
  feature: string
  study: string
  agent: string
  model: string
  session_id: string
  claude: bool
]: nothing -> record<active_feature_dir: string, feature_name: string, proposal_file: string, task_index: string, feature_plan: string, study: string, agent: string, effective_model: string, session_id: string, claude: bool, cli: string> {
  let effective_model = if $model == "" {
    if $claude { "sonnet" } else { "openai-codex/gpt-5.5:low" }
  } else {
    $model
  }

  let active_feature_dir = (feature-dir $feature)
  let feature_name = ($active_feature_dir | path basename)
  let proposal_file = $"($active_feature_dir)/proposal.md"
  let task_index = $"($active_feature_dir)/tasks/index.yml"
  let feature_plan = $"($active_feature_dir)/($feature_name).plan.md"

  if not ($proposal_file | path exists) {
    error make { msg: $"missing feature proposal: ($proposal_file)" }
  }

  if not ($task_index | path exists) {
    error make { msg: $"missing task index: ($task_index)" }
  }

  if not ($feature_plan | path exists) {
    error make { msg: $"missing feature plan: ($feature_plan)" }
  }

  {
    active_feature_dir: $active_feature_dir
    feature_name: $feature_name
    proposal_file: $proposal_file
    task_index: $task_index
    feature_plan: $feature_plan
    study: $study
    agent: $agent
    effective_model: $effective_model
    session_id: $session_id
    claude: $claude
    cli: (if $claude { "claude" } else { "pi" })
  }
}

export def run-task-cycle [
  ctx: record<
    active_feature_dir: string,
    feature_name: string,
    proposal_file: string,
    task_index: string,
    feature_plan: string,
    study: string,
    agent: string,
    effective_model: string,
    session_id: string,
    claude: bool,
    cli: string
  >
  task: string
  loop_count: int
] {
  ensure-clean-before-pending $task

  let session_name = (task-session-name $ctx.feature_name $task $loop_count)
  # mint a task session id so build phases resume this exact session, not "most recent in cwd"
  let task_session_id = (random uuid)
  let init_command = if $ctx.claude { "/devflow:flow-init--afk" } else { "/flow-init--afk" }
  let prompt = $"($init_command) study Active feature folder: ($ctx.active_feature_dir)\nProposal file: ($ctx.proposal_file)\nTask index file: ($ctx.task_index)\nFeature plan file: ($ctx.feature_plan)\nAdditional context: ($ctx.study)\n\nSelected task:\n($task)"
  loop-line $"cycle ($loop_count): ($session_name)"
  stage-line $"running: ($init_command) with selected task from ($ctx.task_index)"

  let res = if $ctx.claude {
    $prompt | claude --print --dangerously-skip-permissions --model $ctx.effective_model --name $session_name --session-id $task_session_id | complete
  } else {
    pi --agent $ctx.agent --model $ctx.effective_model --name $session_name --session-id $task_session_id -p $prompt | complete
  }

  if $res.exit_code != 0 {
    { ok: false, phase: "init", stderr: $res.stderr }
  } else {
    let out = ($res.stdout | str trim)
    print $out

    if (has-token $out "BLOCKED") {
      stop-line "afk loop stopped: task blocked"
      return { ok: true, stop: "blocked" }
    }

    if (has-token $out "NO_TASKS_REMAIN") {
      stop-line "afk loop stopped: no runnable tasks remain"
      return { ok: true, stop: "no_tasks" }
    }

    let refine_command = if $ctx.claude { "/devflow:flow-build--refine" } else { "/flow-build--refine" }
    stage-line $"running: ($refine_command)"
    let refine = if $ctx.claude {
      $refine_command | claude --print --dangerously-skip-permissions --resume $task_session_id | complete
    } else {
      pi --session-id $task_session_id -p $refine_command | complete
    }
    if $refine.exit_code != 0 {
      print $refine.stderr
      error make { msg: "refine failed" }
    }
    print ($refine.stdout | str trim)

    let smoke_command = if $ctx.claude { "/devflow:flow-build--smoke" } else { "/flow-build--smoke" }
    stage-line $"running: ($smoke_command)"
    let smoke = if $ctx.claude {
      $smoke_command | claude --print --dangerously-skip-permissions --resume $task_session_id | complete
    } else {
      pi --session-id $task_session_id -p $smoke_command | complete
    }
    if $smoke.exit_code != 0 {
      print $smoke.stderr
      error make { msg: "smoke failed" }
    }
    print ($smoke.stdout | str trim)

    let git_status = (git status --porcelain)
    if ($git_status | str trim) != "" {
      let finalise_command = if $ctx.claude { "/devflow:flow-build--finalise" } else { "/flow-build--finalise" }
      stage-line $"running: ($finalise_command)"
      print (git status --short)

      let finalise = if $ctx.claude {
        $finalise_command | claude --print --dangerously-skip-permissions --resume $task_session_id | complete
      } else {
        pi --session-id $task_session_id -p $finalise_command | complete
      }
      if $finalise.exit_code != 0 {
        print $finalise.stderr
        error make { msg: "flow-build--finalise failed" }
      }

      let finalise_out = ($finalise.stdout | str trim)
      print $finalise_out

      let final_status = (git status --porcelain)
      if ($final_status | str trim) != "" {
        error-line "afk loop stopped: flow-build--finalise left uncommitted work"
        print (git status --short)
        error make { msg: "flow-build--finalise left uncommitted work" }
      }

      if (has-token $finalise_out "BLOCKED") {
        stop-line "afk loop stopped: finalise blocked"
        return { ok: true, stop: "blocked" }
      }

      if (has-token $finalise_out "NO_TASKS_REMAIN") {
        stop-line "afk loop stopped: no runnable tasks remain"
        return { ok: true, stop: "no_tasks" }
      }
    }

    { ok: true, stop: "" }
  }
}

export def maybe-run-owner-review [
  ctx: record<
    active_feature_dir: string,
    feature_name: string,
    proposal_file: string,
    task_index: string,
    feature_plan: string,
    study: string,
    agent: string,
    effective_model: string,
    session_id: string,
    claude: bool,
    cli: string
  >
] {
  if (all-tasks-complete $ctx.task_index) {
    if $ctx.session_id == "" {
      success-line "afk loop completed all tasks; skipping owner review because --session-id was not provided"
    } else {
      let owner_review_command = if $ctx.claude { $"/devflow:flow-review--owner ($ctx.feature_name)" } else { $"/flow-review--owner ($ctx.feature_name)" }
      stage-line $"running owner review in original session: ($owner_review_command)"
      let owner_review = if $ctx.claude {
        $owner_review_command | claude --print --dangerously-skip-permissions --resume $ctx.session_id | complete
      } else {
        pi --session-id $ctx.session_id -p $owner_review_command | complete
      }
      if $owner_review.exit_code != 0 {
        print $owner_review.stderr
        error make { msg: "flow-review--owner failed" }
      }
      print ($owner_review.stdout | str trim)
    }
  }
}

export def next-task [task_index: string] {
  let items = (task-items $task_index)
  validate-task-index $items

  let complete = (completed-task-ids $items)
  let in_progress = ($items | where status == "in_progress" | sort-by id)

  if ($in_progress | length) > 0 {
    $in_progress | first | to yaml
  } else {
    let pending = (
      $items
      | where {|task|
        ($task.status == "pending") and (((unmet-blockers $task $complete) | length) == 0)
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

export def task-by-id [task_index: string, id: string] {
  let items = (task-items $task_index)
  validate-task-index $items

  let matches = ($items | where {|task| (task-id $task.id) == (task-id $id) })
  if ($matches | length) == 0 {
    error make { msg: $"task id not found in ($task_index): ($id)" }
  }

  let task = ($matches | first)
  let status = $task.status
  if $status == "complete" {
    error make { msg: $"task ($id) is already complete" }
  }
  if $status == "blocked" {
    error make { msg: $"task ($id) is blocked" }
  }
  if $status != "pending" and $status != "in_progress" {
    error make { msg: $"task ($id) has unsupported status: ($status)" }
  }

  if $status == "pending" {
    let complete = (completed-task-ids $items)
    let unmet = (unmet-blockers $task $complete)
    if ($unmet | length) > 0 {
      error make { msg: $"task ($id) has unmet blockers: ($unmet | str join ', ')" }
    }
  }

  $task | to yaml
}

export def ensure-clean-before-pending [task: string] {
  let dirty_status = (git status --porcelain | str trim)
  if $dirty_status != "" and (task-status $task) != "in_progress" {
    error-line "afk loop stopped: uncommitted work before starting pending task"
    print (git status --short)
    error make { msg: "uncommitted work before pending task" }
  }
}

export def all-tasks-complete [task_index: string] {
  let items = (task-items $task_index)
  ($items | length) > 0 and (($items | where status != "complete" | length) == 0)
}

export def completed-task-ids [items: table] {
  $items | where status == "complete" | get id | each {|id| task-id $id }
}

export def unmet-blockers [task: record, complete: list] {
  ($task.blocked_by? | default []) | where {|id| (task-id $id) not-in $complete}
}

export def validate-task-index [items: table] {
  let ids = ($items | get id | each {|id| task-id $id })
  let unknown_blockers = (
    $items
    | each {|task| ($task.blocked_by? | default []) | where {|id| (task-id $id) not-in $ids} }
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

export def task-status [task: string] {
  ($task | from yaml).status
}

export def task-session-name [feature_name: string, task: string, loop_count: int] {
  let task = ($task | from yaml)
  let id = $task.id
  let description = (
    $task.description
    | str trim
    | str replace --all --regex "\\s+" " "
    | str replace --all --regex "[^A-Za-z0-9._ -]" "-"
  )

  $"afk-($feature_name)-($loop_count)-($id)-($description)"
}

export def feature-dir [feature: string] {
  let trimmed = ($feature | str trim)
  if ($trimmed | str starts-with "devflow/feat/") {
    $trimmed
  } else if ($trimmed | str starts-with "devflow/") {
    error make { msg: $"active feature folders live under devflow/feat/: ($trimmed)" }
  } else {
    $"devflow/feat/($trimmed)"
  }
}

export def task-items [task_index: string] {
  (open $task_index).tasks
}

export def task-id [id: any] {
  $id | into string
}

export def has-token [out: string, token: string] {
  $out == $token or ($out | str contains $token)
}

export def success-line [message: string] {
  color-line green_bold $"✓ ($message)"
}

export def error-line [message: string] {
  color-line red_bold $"✖ ($message)"
}

export def stop-line [message: string] {
  color-line yellow_bold $"■ ($message)"
}

export def stage-line [message: string] {
  color-line purple_bold $"  ◆ ($message)"
}

export def loop-line [message: string] {
  color-line cyan_bold $"▶ ($message)"
}

export def color-line [color: string, message: string] {
  print $"(ansi $color)($message)(ansi reset)"
}

export def complete-features [] {
  if not ("devflow/feat" | path exists) {
    return []
  }

  ls devflow/feat
  | where type == dir
  | get name
  | each {|name| $name | path basename }
  | sort
}
