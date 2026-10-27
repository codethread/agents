# "Show me"

Map the context sources that **will** and **might** load for the stated session or task: instruction files, skill metadata and bodies, CLI responses, and hook or extension output. Distinguish automatically injected content, required loads once a condition applies, and optional loads. Separate skill metadata from skill bodies, and a parent agent's context from delegated agents' contexts. Say whether the map describes configured or instructed behavior, or an observed session trace; identify unverified sources.

Structure the report as several small trees or graphs, not one giant diagram:

- Group by reading trigger: startup, exploration or editing, task-specific documents and skills, then specialist delegation. Split busy groups further when needed.
- Use short node labels and terse trigger labels on connections. Put exact file paths or provider/command names and supporting detail directly beneath each tree, rather than crowding the nodes.
- Keep every section visible in one reading sequence; normal scrolling is fine. Avoid tabs, accordions and deeply nested expandable lists that hide branches.
- Reuse references to shared files across trees rather than implying each occurrence is another mandatory read.

Use any available visualisation tools you may already have; no particular tool, renderer or document format is required. Without one, use several small labelled text trees or grouped lists with the same structure. Do not install tooling just to produce the report.

For the **might** loads, give a separate terse list beneath the relevant tree: **source — likely trigger — score out of 5**. Score expected loading for the stated scenario: **5 = always loaded, 0 = never loaded**. Treat intermediate scores as estimates, not measured probabilities; say unknown when the evidence is insufficient.

Finish with a short distinction between baseline and conditional context cost. If giving size or token estimates, state the method and what is excluded.
