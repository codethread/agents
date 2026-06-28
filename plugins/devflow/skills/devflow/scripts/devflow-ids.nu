# Devflow document ID helper.
#
# Usage:
#   use plugins/devflow/skills/devflow/scripts/devflow-ids.nu *
#   devflow-ids scan devflow
#   devflow-ids next DELTA devflow

const known_prefixes = [RFC SPEC DELTA PROP PLAN TASK]

# Scan devflow markdown documents for `**Document ID:**` values, duplicate IDs, and next IDs by prefix.
export def "devflow-ids scan" [
  devflow_dir: path = "devflow" # Planning workspace root to scan.
] {
  let rows = (document_id_rows $devflow_dir)
  let duplicates = ($rows | group-by id | transpose id rows | where { |it| ($it.rows | length) > 1 })
  let next_ids = (next_id_rows $rows)

  {
    documents: $rows
    duplicates: ($duplicates | each { |it| { id: $it.id occurrences: ($it.rows | select path line) } })
    next_ids: $next_ids
  }
}

# Print the next unused document ID for a prefix such as DELTA, SPEC, PLAN, PROP, RFC, or TASK.
export def "devflow-ids next" [
  prefix: string # Document prefix, e.g. DELTA.
  devflow_dir: path = "devflow" # Planning workspace root to scan.
] {
  let normalized = ($prefix | str upcase)
  if not ($normalized in $known_prefixes) {
    error make { msg: $"unknown devflow document prefix: ($prefix)" }
  }

  let rows = (document_id_rows $devflow_dir)
  let max_num = ($rows | where prefix == $normalized | get num --optional | math max)
  let next_num = (($max_num | default 0) + 1)
  $"($normalized)-($next_num | fill --alignment right --character '0' --width 3)"
}

# Internal: collect one row per markdown `Document ID` declaration.
def document_id_rows [devflow_dir: path] {
  let pattern = '^\*\*Document ID:\*\* `(?<id>(?<prefix>RFC|SPEC|DELTA|PROP|PLAN|TASK)-(?<num>\d{3}))`'
  let output = (do { ^rg --no-heading --line-number --pcre2 $pattern $devflow_dir -g '*.md' } | complete)

  if $output.exit_code not-in [0 1] {
    error make { msg: $output.stderr }
  }

  $output.stdout
  | lines
  | parse --regex '^(?<path>.*):(?<line>\d+):\*\*Document ID:\*\* `(?<id>(?<prefix>RFC|SPEC|DELTA|PROP|PLAN|TASK)-(?<num>\d{3}))`'
  | update line { |row| $row.line | into int }
  | update num { |row| $row.num | into int }
  | sort-by prefix num path
}

# Internal: compute next IDs for all known prefixes.
def next_id_rows [rows: table] {
  $known_prefixes
  | each { |prefix|
      let max_num = ($rows | where prefix == $prefix | get num --optional | math max)
      let next_num = (($max_num | default 0) + 1)
      {
        prefix: $prefix
        next: $"($prefix)-($next_num | fill --alignment right --character '0' --width 3)"
      }
    }
}
