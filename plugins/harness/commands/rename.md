---
description: Rename the tmux/terminal window title
argument-hint: <title text>
disable-model-invocation: true
---

Set the window title to a kebab-cased, <=30 character version of: $ARGUMENTS

This is normally handled entirely by the harness `window-title` UserPromptSubmit hook, which applies the title and stops this prompt before it reaches you. If you are reading this, that hook did not run — rename the window yourself with `tmux rename-window` (when `$TMUX` is set) or an OSC-2 escape to the terminal, then stop.
