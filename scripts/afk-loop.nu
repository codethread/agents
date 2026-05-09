# Repeatedly run the /afk prompt until the queue is blocked or exhausted.
#
# Example:
#   use /Users/codethread/dev/projects/agents/scripts/afk-loop.nu
#   afk-loop "@tasks/index.yml, task files under @tasks/, ALL @specs/README.md and @UBIQUITOUS_LANGUAGE.md"

export def main [
  study: string                                # Text appended after `/afk study `: task entry point plus specs/context to read
  --agent: string = "main"                    # Pi agent to run
  --model: string = "openai-codex/gpt-5.5:low" # Pi model to run
] {
  loop {
    let prompt = $"/afk study ($study)"
    print $"running: ($prompt)"

    let res = (
      pi --agent $agent --model $model -p $prompt | complete
    )

    if $res.exit_code != 0 {
      print $res.stderr
      error make { msg: "pi failed" }
    }

    let out = ($res.stdout | str trim)
    print $out

    if $out == "COMPLETE" {
      pi -c -p "/refine"
      pi -c -p "/smoke"
      continue
    }

    if $out == "BLOCKED" {
      print "afk loop stopped: task blocked"
      break
    }

    if $out == "NO_TASKS_REMAIN" {
      print "afk loop stopped: no runnable tasks remain"
      break
    }

    error make { msg: $"unexpected /afk output: expected COMPLETE, BLOCKED, or NO_TASKS_REMAIN; got '($out)'" }
  }
}
