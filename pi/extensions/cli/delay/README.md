# delay

Registers `/delay <time> <prompt>`.

The command schedules `prompt` to be sent as a user message after `time` elapses. Durations use `ms`-style strings such as `1s`, `5m`, `2h`, or `1d`.

Example:

```text
/delay 20m check whether the brew upgrade likely finished and continue from here
```

Delayed prompts are delivered as follow-up user messages, so they queue behind any agent turn that is still running when the timer fires.
