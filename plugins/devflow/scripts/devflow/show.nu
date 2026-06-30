# Devflow task queue display commands.

use helpers.nu *

# Render a feature task queue or tasks/index.yml as a readable terminal DAG.
#
# Requires `graph-easy` on PATH. The Nix dev profile provides it via Graph::Easy.
# Use --dot to print Graphviz DOT without requiring graph-easy.
export def main [
  input: string@complete-features           # Feature name, active feature folder, or tasks/index.yml path
  --format: string = "boxart"              # graph-easy output format: boxart or ascii
  --wrap: int = 0                           # Maximum label line width; 0 infers from terminal width
  --direction: string = "auto"              # auto, LR, or TB
  --padding: int = 16                       # Columns to reserve when inferring wrap/direction
  --dot                                      # Print DOT instead of rendering
] {
  let task_index = (resolve-task-index $input)
  let items = (task-items $task_index)
  validate-task-index $items
  validate-graph-easy-format $format
  let effective_direction = (effective-direction $direction $padding)
  let effective_wrap = (effective-wrap $wrap $items $effective_direction $padding)

  let dot_text = (tasks-to-dot $items $effective_wrap $effective_direction)

  if $dot {
    print $dot_text
    return
  }

  let dot_file = (mktemp --tmpdir --suffix .dot devflow-tasks.XXXXXX)
  $dot_text | save --force $dot_file

  if not (is-graph-easy-available) {
    print $dot_text
    error make { msg: "graph-easy not found on PATH. Install the Nix dev profile that includes Graph::Easy, or re-run with --dot to print DOT only." }
  }

  ^graph-easy $dot_file --as $format
}

def resolve-task-index [input: string] {
  let trimmed = ($input | str trim)
  if ($trimmed | path type) == "file" {
    $trimmed
  } else if (($trimmed | str ends-with ".yml") or ($trimmed | str ends-with ".yaml")) {
    if not ($trimmed | path exists) {
      error make { msg: $"missing task index: ($trimmed)" }
    }
    $trimmed
  } else {
    let active_feature_dir = (feature-dir $trimmed)
    let task_index = $"($active_feature_dir)/tasks/index.yml"
    if not ($task_index | path exists) {
      error make { msg: $"missing task index: ($task_index)" }
    }
    $task_index
  }
}

def effective-direction [requested: string, padding: int] {
  let normalized = ($requested | str upcase)
  if $normalized in ["LR" "TB"] {
    return $normalized
  }
  if $normalized != "AUTO" {
    error make { msg: "--direction must be auto, LR, or TB" }
  }

  let usable_columns = ([20 (((term size).columns? | default 80) - $padding)] | math max)
  if $usable_columns < 120 { "TB" } else { "LR" }
}

def effective-wrap [requested: int, items: table, direction: string, padding: int] {
  if $requested != 0 {
    if $requested < 8 {
      error make { msg: "--wrap must be 0 or at least 8" }
    }
    return $requested
  }

  let columns = ((term size).columns? | default 80)
  let usable_columns = ([20 ($columns - $padding)] | math max)
  let node_count = ($items | length)
  let rank_nodes = if $direction == "TB" { 3 } else { [$node_count 6] | math min }
  let inferred = (($usable_columns / $rank_nodes | into int) - 5)
  let floor_applied = ([8 $inferred] | math max)
  [$floor_applied 24] | math min
}

def tasks-to-dot [items: table, wrap: int, direction: string] {
  if $wrap < 8 {
    error make { msg: "--wrap must be at least 8" }
  }

  let node_lines = (
    $items
    | sort-by id
    | each {|task|
      let id = (task-id $task.id)
      let label = (dot-label $task $wrap)
      $"  \"($id)\" [label = \"($label)\"];"
    }
    | str join "\n"
  )

  let edge_lines = (
    $items
    | sort-by id
    | each {|task|
      let to = (task-id $task.id)
      ($task.blocked_by? | default [])
      | each {|blocked_id|
        let from = (task-id $blocked_id)
        $"  \"($from)\" -> \"($to)\";"
      }
    }
    | flatten
    | str join "\n"
  )

  let body = if $edge_lines == "" { $node_lines } else { [$node_lines $edge_lines] | str join "\n\n" }

  $"digraph devflow_tasks {\n  rankdir = ($direction);\n  node [shape = box];\n\n($body)\n}\n"
}

def dot-label [task: record, wrap: int] {
  let header = $"(task-id $task.id) ($task.status)"
  let desc = ($task.description | str trim | wrap-words $wrap)
  let label = ([$header] | append $desc | str join "\\n")
  $label | dot-escape-label
}

def wrap-words [width: int]: string -> list<string> {
  let text = $in
  let words = ($text | str replace --all --regex "\\s+" " " | str trim | split row " ")
  let result = ($words | reduce --fold {lines: [], current: ""} {|word, acc|
    let candidate = if $acc.current == "" { $word } else { $"($acc.current) ($word)" }
    if (($candidate | str length) <= $width) {
      {lines: $acc.lines, current: $candidate}
    } else if $acc.current == "" {
      {lines: ($acc.lines | append $word), current: ""}
    } else {
      {lines: ($acc.lines | append $acc.current), current: $word}
    }
  })

  if $result.current == "" { $result.lines } else { $result.lines | append $result.current }
}

def dot-escape-label []: string -> string {
  $in
  | str replace --all "\\" "\\\\"
  | str replace --all "\"" "\\\""
}

def validate-graph-easy-format [format: string] {
  if $format not-in ["boxart" "ascii"] {
    error make { msg: "--format must be boxart or ascii" }
  }
}

def is-graph-easy-available [] {
  (which graph-easy | length) > 0
}
