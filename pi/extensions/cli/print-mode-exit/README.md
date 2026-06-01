# print-mode-exit

Forces `pi -p` / `pi --print` processes to exit shortly after `agent_end`.

This is a local workaround for Pi print-mode runs that emit their final JSON events but keep Node handles alive indefinitely, which blocks callers such as the `subagent` tool from receiving process close.

Interactive Pi sessions are unaffected.
