# Workflows

Use numbered steps when order is linear. Draw a branched workflow as a basic ASCII flow showing the entry point, main decisions and outcomes. Add a compact decision table or named states only when the flow needs supporting detail.

```text
START
  |
  v
[condition?] -- yes --> [path A]
  |
  no
  v
[path B]
```

If the main workflow cannot be represented clearly with a basic ASCII flow, assume the document is trying to do too much. Discuss narrowing its scope, splitting it, extracting subworkflows or simplifying its branches.

Use a Mermaid diagram only when that discussion rejects those alternatives for concrete reasons and the document still covers one coherent job. Load the `mermaid` skill before authoring the diagram.

## Acceptance checks

- Does the sequence or flow show where to start, how to choose each branch and what outcome ends it?
- Do the labels name decisions and actions the reader can actually perform or observe?
- Does any supporting table add necessary detail rather than retell the flow?
- If using Mermaid, were simpler alternatives discussed and rejected for concrete reasons within this document's scope?
