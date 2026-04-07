# Discovery Notes

**Status:** Living notes
**Last Updated:** 2026-04-07

## Purpose

This file is intentionally not a formal domain specification. It is a lightweight place to capture cross-cutting discoveries, implementation notes, and behavioral quirks that are worth revisiting when writing or updating future specs.

Use it as a quick reference alongside the domain specs in this directory.

## Notes

### Dynamic tool registration in Pi is additive-friendly

Pi supports dynamic tool registration after extension startup. In practice, this works well for additive behavior:

- an extension can register tools during `session_start`
- an extension can react to `model_select`
- an extension can enable or disable already-known tools with `pi.setActiveTools(...)`

This makes model-conditional tools feasible, such as registering a tool only when the current model id includes `mini`.

### Tool removal can leave the agent with stale assumptions

If a tool is available to the agent and is later removed or disabled, the agent may still behave as though that tool exists. This is expected because the model reasons from previously provided tool context and conversation state; removing a tool mid-session does not erase the model's prior assumptions.

Implication for future extension design:

- prefer dynamic tool behavior that is primarily additive
- be cautious with subtractive behavior, especially mid-session
- if tool availability must shrink, assume the model may still try to call or reason about the old tool until context is refreshed or the session state naturally moves on

### before_agent_start can apply model-conditional prompt behavior

Extensions can inspect the active runtime model in `before_agent_start` and append prompt instructions conditionally for that run. As an experiment, the package now also inspects `process.argv` for CLI-passed `--provider` / `--model` values and compares them with the runtime model seen by the hook.

This is useful for discovery and debugging because it helps answer two separate questions:

- what model/provider was explicitly requested from the CLI
- what model/provider the extension actually sees at hook execution time

For the current experiment, if the selected model id includes `mini`, the extension appends a pirate-speaking instruction to the system prompt and reports whether that decision came from CLI selection or runtime model state.

### Recommendation

When building model-dependent tool systems, prefer this pattern:

1. register candidate tools dynamically when they first become relevant
2. keep the behavior understandable and stable within a session
3. use activation/deactivation conservatively
4. treat removal as a UX and prompting concern, not just a runtime state change
5. when debugging prompt behavior, distinguish CLI-requested model selection from the runtime model visible inside hooks
