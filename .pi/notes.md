# working memory (git tracked)

> this is an append only list of ideas to be considered or implemented or woven into specs at some point
>
> - [ ] not done
> - [~] claimed by agent (wip)
> - [x] done

- [x] improve matrix.json to include the original user request and the used agent prompt (helps to eval intent and re-run if needed)
- [x] it would be good support other harness for `/bench`, e.g `codex exec <task` and `claude --print`
- [x] questionnaire needs to be hidden if not main UI agent
- [ ] we might need to disable subagents for tasks, easy enough with a `--disable-subagents bob,bill,babra` list which hides them from the tool info
- [ ] should likely disable subagents for the orchestrator when doing benchmarks - they really should read the files
- [ ] give subagents a resume function for debate
