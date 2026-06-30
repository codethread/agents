export use all.nu
export use next.nu
export use run.nu

# Show devflow automation usage.
export def main [] {
  print "Usage: devflow <all|next|run> ..."
  print ""
  print "Subcommands:"
  print "  all   Repeatedly run runnable tasks until blocked or exhausted"
  print "  next  Run one cycle for the next runnable task"
  print "  run   Run one cycle for a specific task id"
}
