---
name: worker
description: >
  General worker agent, same tools as you, use when needing to delegate large slices of known work
tools: read, bash, edit, write, subagent, interactive_shell
hidden: true
model:
  - id: anthropic/claude-sonnet-5-5:low
    when: "~/pb/**"
  - deepseek/deepseek-flash:max
---
