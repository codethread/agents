export use all.nu
export use next.nu
export use launch.nu
export use show.nu

# Show devflow automation usage.
export def main [] {
  print "Usage: devflow <all|next|run|show> ..."
  print ""
  print "Subcommands:"
  print "  all   Repeatedly run runnable tasks until blocked or exhausted"
  print "  next  Run one cycle for the next runnable task"
  print "  launch   Launch one cycle for a specific task id"
  print "  show  Print the feature task queue as a human-readable DAG"
}
