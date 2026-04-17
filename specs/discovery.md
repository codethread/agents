# Discovery Notes

**Status:** Living notes
**Last Updated:** 2026-04-17

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

### Agent tool allowlists must use runtime activation for extension tools

Pi's CLI `--tools` parsing happens before extension tools are registered, so it cannot be the sole enforcement mechanism when an agent needs an exact tool set that includes extension-defined tools.

Implication for subagent/direct-agent design:

- treat built-in and extension tools as one logical namespace in agent frontmatter
- preserve extension tool names through discovery instead of dropping them as "unknown"
- enforce the final allowlist with runtime `setActiveTools(...)`, not just CLI `--tools`
- when delegating child runs, prefer `pi --agent <name>` over manually reconstructing prompt/model/tool flags so direct and delegated execution stay aligned

### Recommendation

When building model-dependent tool systems, prefer this pattern:

1. register candidate tools dynamically when they first become relevant
2. keep the behavior understandable and stable within a session
3. use activation/deactivation conservatively
4. treat removal as a UX and prompting concern, not just a runtime state change
5. when debugging prompt behavior, distinguish CLI-requested model selection from the runtime model visible inside hooks

### Dynamic Context Injection and LLM Caching ("Lost in the Middle")

When injecting dynamic context (e.g. project-specific instructions from an `AGENTS.md` file loaded mid-session), you face a tradeoff between LLM attention and API caching (Prompt Caching):

**Option A: Modify the System Prompt**

- **How:** Dynamically modify `event.systemPrompt` in the `before_agent_start` hook.
- **Attention:** Perfect. The LLM always sees it clearly at the top of the context window.
- **Cache impact:** **100% Cache Miss.** Because the very beginning of the API payload changes on every turn, providers (Anthropic, OpenAI) will discard their prefix cache and recalculate the entire conversation history from scratch. This is expensive and slow.

**Option B: Inject as a User Message (Recommended)**

- **How:** Inject the context once as a normal user message (e.g. wrapped in `<backend_context>...</backend_context>`).
- **Attention:** Very High initially, but suffers from the "Lost in the Middle" problem as the conversation progresses and the message drifts backwards.
- **Cache impact:** **Cache Hit.** Because you only append to the end of the `messages` array, the provider's cache for the system prompt and all previous turns remains completely valid.

**Mitigating "Lost in the Middle" with Option B:**
To maintain attention on the injected context without busting the cache, append a lightweight, explicit attention nudge to the _end_ of the user's latest message on subsequent turns. For example:

> `[System note: Remember to follow the <backend_context> provided earlier.]`
> Anthropic research shows that explicitly directing the model's attention immediately before the task drastically improves recall of middle-context information.

### Note on Mid-Session Model Changing

Switching the LLM provider or model id mid-session (e.g. from `claude-3-5-sonnet` to `gpt-4o`) will completely invalidate the API prompt cache for the new provider. While this is obvious across different providers, even switching to a different model _within the same provider_ (e.g. `sonnet` to `haiku`) will typically bust the cache, as cache state is strictly bound to the specific model version that originally processed the prefix. This must be a mindful tradeoff when managing session cost and latency.
