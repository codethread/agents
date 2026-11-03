# Rich response intent

Rich response lets an agent author a small semantic HTML fragment while the bundled template owns visual design, diagram/highlighting libraries, validation and local publication. Static documents retain stable URLs when rerendered. Keep the authoring surface familiar and keep dependencies out of the agent's task.

## Live questionnaires

The interactive branch is explicitly user-invoked through a request for a questionnaire or alignment check. Many questions, uncertainty or a general workshop do not trigger it; ordinary conversation and static rich documents remain the defaults appropriate to their tasks. The combined skill remains discoverable for its existing document purposes, with only a compact questionnaire trigger and routing paragraph; interaction details stay in the disclosed guide.

The agent investigates first and compresses its findings into the fewest meaningful decisions, with brief context, a reason and main tradeoff for each recommendation, and a way to disagree or discuss. Recommendations are deliberately not selections; explicit submission establishes the user's answers.

The same agent remains active throughout. A unique local Markdown answer path is the return contract shared by Codex, Claude Code, Pi and other command/file-capable agents. A shell process waits for the file without repeated model polling. Once the agent reads the submitted answers, it immediately acknowledges receipt before analyzing them: browser confirmation means saved, while agent acknowledgment confirms the conversation has received them. There are no session injections, proprietary callbacks, ended-session wakeups or durable handoffs.

Questionnaires reuse the rich-response presentation and server, using ordinary fieldsets, legends, labels and native controls. A focused parser derives trusted wording and available choices from that HTML. This avoids a separate form-schema authoring language or generic form framework. Questionnaire instructions are disclosed only for the interactive branch; the main skill remains the entry point for static responses.

Visual hierarchy must not make supporting text hard to read. Keep the Rose Pine hues while maintaining at least 4.5:1 contrast for secondary text on page and inset surfaces in both themes. Distinguish necessary control boundaries (at least 3:1) from quiet decorative borders, and preserve native keyboard behavior, visible focus, labels and live submission feedback. Verify actual computed colors and narrow layouts as well as the palette regression tests; palette thresholds alone do not establish full accessibility conformance.

Each render has a fresh identity, capability and answer path, including repeated titles. The server publishes the completed Markdown file atomically only after explicit submission and acknowledges success only after saving. The first completed answer is retained; identical retries are safe and changes require a fresh questionnaire. This keeps the active agent from consuming partial, stale or overwritten decisions.

LAN and Tailscale answer submission are capability-scoped; document publication remains loopback-only. The service uses fixed port 8765 directly on the existing Tailscale interface. Publication discovers and verifies the local machine’s address and checks that Tailscale allows incoming connections, returning exact document and bookmark URLs rather than asking agents to infer them. A self-probe can succeed while the device-wide shields-up preference blocks peers; that state must be reported as unavailable, not advertised as phone access. The publisher diagnoses the preference without changing it. This avoids reconfiguring Tailscale Serve or displacing another application on the default address/port. Existing tailnet access rules and account state remain untouched.

A minimal stable service-root page lists the 20 most recent published documents and questionnaire submission status. It lets the user bookmark an entry point across fresh questionnaires, while agents still send each specific questionnaire link. This intentionally makes recent links discoverable to anyone who can reach the service; the intended audience is a trusted LAN/tailnet. Answer contents remain local files. A local address probe and an off-network phone test are distinct evidence.

The first version has no public hosting, application account system or arbitrary action execution. The agent reads and interprets answers, resolves disagreements and continues only previously authorized work. Plain HTTP over the LAN or Tailscale and temporary storage suit a live workshop, not a durable survey service.

Verification covers authoring and Markdown boundaries, synthetic browser POSTs through LAN and Tailscale addresses, atomic file delivery to a waiting process, submission capability checks, loopback-only publication and retry behavior. Keep the user's demonstration questionnaire unanswered until they submit it.
