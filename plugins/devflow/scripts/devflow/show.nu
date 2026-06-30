# Devflow task queue display commands.

use helpers.nu *

# Render a feature task queue or tasks/index.yml as a readable terminal DAG.
export def main [
  input: string@complete-features           # Feature name, active feature folder, or tasks/index.yml path
  --format: string = "boxart"              # graph-easy output format: boxart or ascii
  --wrap: int = 20                          # Maximum label line width before wrapping words
  --dot                                      # Print DOT instead of rendering
] {
  let task_index = (resolve-task-index $input)
  let items = (task-items $task_index)
  validate-task-index $items
  validate-graph-easy-format $format

  let dot_text = (tasks-to-dot $items $wrap)

  if $dot {
    print $dot_text
    return
  }

  let dot_file = (mktemp --tmpdir --suffix .dot devflow-tasks.XXXXXX)
  $dot_text | save --force $dot_file

  if not (is-graph-easy-available) {
    print $dot_text
    error make { msg: "graph-easy not found. Install with `PERL_MM_USE_DEFAULT=1 cpan -T Graph::Easy`, then ensure ~/perl5/bin is on PATH and ~/perl5/lib/perl5 is on PERL5LIB. Re-run with --dot to print DOT only." }
  }

  with-env (graph-easy-env) {
    ^graph-easy $dot_file --as $format
  }
}

# Print only the generated DOT for a feature task queue or index file.
export def dot [
  input: string@complete-features
  --wrap: int = 20
] {
  let task_index = (resolve-task-index $input)
  let items = (task-items $task_index)
  validate-task-index $items
  print (tasks-to-dot $items $wrap)
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

def tasks-to-dot [items: table, wrap: int] {
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

  $"digraph devflow_tasks {\n  rankdir = LR;\n  node [shape = box];\n\n($body)\n}\n"
}

def dot-label [task: record, wrap: int] {
  let header = $"(task-id $task.id) ($task.status)"
  let desc = ($task.description | str trim | wrap-words $wrap)
  let label = ([$header] | append $desc | str join "\\n")
  dot-escape-label $label
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
  (which graph-easy | length) > 0 or ($"($env.HOME)/perl5/bin/graph-easy" | path exists)
}

def graph-easy-env [] {
  let perl5_bin = $"($env.HOME)/perl5/bin"
  let perl5_lib = $"($env.HOME)/perl5/lib/perl5"
  let perl5_arch = $"($env.HOME)/perl5/lib/perl5/darwin-thread-multi-2level"
  let path = if ($perl5_bin | path exists) { $"($perl5_bin):($env.PATH)" } else { $env.PATH }
  let existing_perl5lib = ($env.PERL5LIB? | default "")
  let perl5lib_parts = ([$perl5_lib $perl5_arch $existing_perl5lib] | where {|part| $part != "" })
  { PATH: $path, PERL5LIB: ($perl5lib_parts | str join ":") }
}
