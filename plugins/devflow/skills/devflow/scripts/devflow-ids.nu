# Devflow document ID helper.
#
# Usage:
#   use plugins/devflow/skills/devflow/scripts/devflow-ids.nu *
#   devflow-ids scan devflow
#   devflow-ids next DELTA Dwr devflow

const known_prefixes = [RFC SPEC DELTA PROP PLAN TASK PRD TEN]

# Scan devflow markdown documents for `**Document ID:**` values, duplicate IDs, and next IDs by prefix/name.
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

# Print the next unused document ID for a prefix/name pair, such as DELTA Dwr.
export def "devflow-ids next" [
  prefix: string # Document prefix, e.g. DELTA.
  name: string # Short document/family name, e.g. Dwr.
  devflow_dir: path = "devflow" # Planning workspace root to scan.
] {
  let normalized = ($prefix | str upcase)
  if not ($normalized in $known_prefixes) {
    error make { msg: $"unknown devflow document prefix: ($prefix)" }
  }

  let rows = (document_id_rows $devflow_dir)
  let nums = ($rows | where prefix == $normalized | where name == $name | get num --optional)
  let max_num = (if ($nums | is-empty) { 0 } else { $nums | math max })
  let next_num = ($max_num + 1)
  format_id $normalized $name $next_num
}

# Internal: collect one row per markdown `Document ID` declaration.
def document_id_rows [devflow_dir: path] {
  let pattern = '^\*\*Document ID:\*\* `(?<id>(?<prefix>[A-Z]+)-(?:(?<name>[A-Za-z][A-Za-z0-9]*)-)?(?<num>\d{2,3})(?:@(?<version>\d+))?)`'
  let output = (do { ^rg --no-heading --line-number --pcre2 $pattern $devflow_dir -g '*.md' } | complete)

  if $output.exit_code not-in [0 1] {
    error make { msg: $output.stderr }
  }

  $output.stdout
  | lines
  | parse --regex '^(?<path>.*):(?<line>\d+):\*\*Document ID:\*\* `(?<id>(?<prefix>[A-Z]+)-(?:(?<name>[A-Za-z][A-Za-z0-9]*)-)?(?<num>\d{2,3})(?:@(?<version>\d+))?)`'
  | update line { |row| $row.line | into int }
  | update num { |row| $row.num | into int }
  | update name { |row| $row.name | default '' }
  | update version { |row| if (($row.version | default '') | is-empty) { 1 } else { $row.version | into int } }
  | sort-by prefix name num version path
}

# Internal: compute next IDs for all known prefix/name pairs already present.
def next_id_rows [rows: table] {
  $rows
  | select prefix name
  | uniq
  | each { |pair|
      let pair_name = ($pair.name | default '')
      let matching = ($rows | where prefix == $pair.prefix | where name == $pair_name)
      let max_num = ($matching | get num | math max)
      let next_num = ($max_num + 1)
      {
        prefix: $pair.prefix
        name: $pair_name
        next: (format_id $pair.prefix $pair_name $next_num)
      }
    }
  | sort-by prefix name
}

def format_id [prefix: string, name: string, num: int] {
  if ($name | is-empty) {
    $"($prefix)-($num | fill --alignment right --character '0' --width 2)"
  } else {
    $"($prefix)-($name)-($num | fill --alignment right --character '0' --width 3)"
  }
}
