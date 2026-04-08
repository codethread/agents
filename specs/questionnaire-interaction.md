# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-08
**Revision:** Reworked from a custom tabbed TUI wizard to an external-editor-backed markdown form model

## 1. Overview

### Purpose

The questionnaire extension provides a structured-input tool for Pi sessions that need user clarification before proceeding. It accepts one or more multiple-choice questions, renders them into a temporary markdown document, opens that document in the user's configured external editor (`$VISUAL` or `$EDITOR`), parses the completed responses after the editor closes, and returns normalized structured results instead of requiring the model to parse arbitrary chat replies.

### Goals

- Let extensions and prompts gather structured user input through a single tool.
- Keep the existing questionnaire tool shape so callers do not need a new contract.
- Lean on the user's existing editor skills instead of maintaining a bespoke interactive questionnaire UI.
- Represent each question in editable markdown using a stable, parseable response block.
- Support predefined options and optional freeform responses in the same section.
- Return machine-usable answers with question IDs, labels, selected values, and whether the answer was custom.
- Make cancellation and editor/configuration failures explicit so callers can distinguish them from valid responses.
- Keep context close to the question by writing it directly into the editable markdown document.

### Non-Goals

- Maintain the previous custom TUI workflow with tabs, option focus state, or inline keyboard navigation.
- Persist questionnaire state across sessions or restarts.
- Support arbitrary nested forms, conditional branching, or rich validation beyond answer extraction.
- Parse arbitrary user prose outside the designated response blocks.
- Linkify file references or provide in-editor code actions; references are plain markdown text for the user's editor to handle.
- Depend on Pi's main input editor for questionnaire completion; this flow is explicitly external-editor-first.

## 2. Architecture

The domain is implemented by a single extension entrypoint:

- `pi-extensions/extensions/questionnaire.ts`

The extension registers a `questionnaire` custom tool with a TypeBox parameter schema. At execution time it:

1. validates that interactive UI is available
2. validates that an external editor is configured via `$VISUAL` or `$EDITOR`
3. normalizes question defaults (`label`, `allowOther`)
4. renders a temporary markdown questionnaire document
5. opens that file in the external editor and blocks until the editor exits
6. reads the edited file back from disk
7. parses the response blocks into normalized answers
8. returns a structured result payload suitable for both LLM consumption and TUI rendering

### Interaction model

The tool no longer owns a custom live questionnaire UI. Instead, it produces a markdown form and delegates all interaction to the user's existing editor.

The markdown document contains:

- an optional top-level context section
- one section per question
- section separators using `---`
- a machine-stable question marker for parsing
- a `<user_response>` block for each question
- markdown checklist items for options
- an optional fenced block for custom freeform text when `allowOther` is enabled

A representative section looks like:

````md
---

<!-- questionnaire-question:architecture -->

## Q1 — Architecture

Which structure should we use?

Relevant constraints and file references here.

<user_response>

- [ ] 1. Use a linked list
- [ ] 2. Use a hashmap
- [ ] 3. Other

```text

```
````

</user_response>

````

The user edits the file in their editor, marks exactly one checkbox per question, optionally fills the fenced block when selecting `Other`, saves, and exits the editor.

### External editor execution

The questionnaire must open in the user's configured external editor.

- Preferred command source: `$VISUAL`, falling back to `$EDITOR`
- The extension writes the markdown form to a temporary file with a `.md` suffix
- Pi's TUI is paused while the editor is running
- When the editor exits successfully, the extension reads the file contents back and parses them
- The temporary file is deleted after the flow completes, regardless of success or failure

If no external editor is configured, the tool must fail fast with a clear error result instead of silently falling back to a different editing surface.

### Context presentation

Context is embedded directly into the generated markdown file rather than emitted into scrollback.

- **Top-level context** (`context` on the root params) appears once near the top of the document under a general context heading.
- **Per-question context** (`context` on individual questions) appears in that question's section, directly above the `<user_response>` block.
- Context remains plain markdown text.
- File references remain plain text and rely on the external editor's normal affordances.

This keeps all information needed to answer the questionnaire in one place and removes the previous split between scrollback context and a separate live TUI viewport.

### Answer extraction model

Each question is parsed independently from its marked response block.

- Exactly one checklist item must be checked within each `<user_response>` block.
- Predefined options map back to the original `options[]` entry by rendered index.
- If `allowOther` is enabled, the final checklist item is `Other`.
- When `Other` is selected, the fenced text block inside the same `<user_response>` block is treated as the custom response body.
- Custom responses are trimmed and returned as both `value` and `label`, with `wasCustom: true`.

If parsing fails for any question, the tool should not invent an answer. It must surface a validation error and allow the user to correct the form.

## 3. Data Model

Implementation-local types in `pi-extensions/extensions/questionnaire.ts`:

```ts
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface Question {
	id: string;
	label: string;
	prompt: string;
	context?: string;
	options: QuestionOption[];
	allowOther: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}
````

Tool input schema:

```ts
{
	context?: string;
	questions: Array<{
		id: string;
		label?: string;
		prompt: string;
		context?: string;
		options: Array<{
			value: string;
			label: string;
			description?: string;
		}>;
		allowOther?: boolean;
	}>;
}
```

Normalization rules:

- missing `label` becomes `Q<n>`
- missing `allowOther` becomes `true`
- missing `context` (top-level or per-question) results in that section being omitted from the generated markdown
- selected predefined options record `index`
- typed answers omit `index` and set `wasCustom: true`

## 4. Interfaces

### Tool registration

The extension exposes:

- tool name: `questionnaire`
- label: `Questionnaire`
- parameters: `QuestionnaireParams` TypeBox schema

### Execution contract

Successful execution returns:

- `content`: human-readable summary lines for the model
- `details`: full `QuestionnaireResult`

Cancellation or execution failure returns:

- `details.cancelled: true`
- explanatory text in `content`

### Editor document contract

The generated markdown document must follow these rules:

- one `---`-delimited section per question
- each question section includes a unique machine marker containing the normalized question ID
- each question section contains exactly one `<user_response>...</user_response>` block
- predefined options render as markdown checklist lines with numeric indices starting at `1`
- when `allowOther` is enabled, the final checklist entry is `Other` and a fenced text block is included for custom text
- option descriptions, when present, appear as plain explanatory text beneath their option label

Example:

````md
<user_response>

- [ ] 1. First option
- [ ] 2. Second option
- [ ] 3. Other

```text
custom response here
```
````

</user_response>

```

### Parsing contract

For each question section:

- if no checkbox is selected, parsing fails for that question
- if multiple checkboxes are selected, parsing fails for that question
- if a predefined option is selected, its original `value`, `label`, and numeric `index` are returned
- if `Other` is selected and the fenced block is empty after trimming, parsing fails for that question
- if `Other` is selected and the fenced block is non-empty, the trimmed text is returned with `wasCustom: true`

### Error recovery contract

Validation errors should be recoverable within the same tool invocation.

Preferred behavior:

- summarize parse errors
- reopen the edited markdown document with those errors prepended or otherwise clearly indicated
- allow the user to fix the form and exit the editor again

If the user closes the editor without fixing the form and then aborts, the tool returns `cancelled: true`.

### Rendering contract

The extension should continue to customize:

- `renderCall(...)` — compact summary showing question count and labels
- `renderResult(...)` — answer-oriented summary with explicit cancelled state

The live TUI does not need a questionnaire-specific custom component anymore. Lightweight progress or notifications around the external editor handoff are acceptable, but the questionnaire interaction itself is editor-driven.

## 5. Design Decisions

- **Decision:** Keep one tool for both single and multi-question flows.
  - **Rationale:** The LLM should not need to choose between separate tools when the only difference is question count.

- **Decision:** Keep the existing tool input shape.
  - **Rationale:** Simplifies migration for prompts, extensions, and agents already using `questionnaire`.

- **Decision:** Move questionnaire interaction into the user's external editor.
  - **Rationale:** Editing markdown and toggling checklist items is already a familiar workflow for many users, and it removes a large amount of bespoke TUI state management.

- **Decision:** Use a temporary markdown file as the interaction medium.
  - **Rationale:** Markdown is human-readable, easy to annotate with context, and straightforward to parse when combined with stable markers and response tags.

- **Decision:** Keep `allowOther` defaulted to enabled.
  - **Rationale:** Clarification workflows frequently need an escape hatch when none of the predefined options match user intent.

- **Decision:** Represent custom answers through an explicit `Other` option plus a fenced text block.
  - **Rationale:** This preserves a mostly uniform question shape while keeping parsing deterministic.

- **Decision:** Embed context directly in the markdown form instead of emitting it to scrollback.
  - **Rationale:** The user should be able to answer the questionnaire with all relevant context in the same editor buffer.

- **Decision:** Fail fast when no external editor is configured.
  - **Rationale:** This design is intentionally external-editor-first. Silent fallback would create inconsistent interaction modes and undermine the simplification goal.

- **Decision:** Preserve the structured `details` result shape.
  - **Rationale:** Downstream logic should continue to receive normalized machine-usable answers even though the interaction surface has changed.

## 6. Testing

Verification should cover:

- `npm run typecheck`
- `npm run lint`
- manual runtime verification in Pi for:
  - single-question questionnaire opened in external editor
  - multi-question questionnaire opened in external editor
  - top-level context rendered in the generated markdown document
  - per-question context rendered in the corresponding question section
  - predefined option parsing
  - custom `Other` response parsing
  - validation failure when no option is selected
  - validation failure when multiple options are selected
  - validation failure when `Other` is selected but the custom fenced block is empty
  - explicit failure when `$VISUAL` and `$EDITOR` are both unset
  - cancellation when the editor exits unsuccessfully or the user aborts during validation retry

There are currently no automated tests for the questionnaire interaction flow.

## 7. Open Questions

- Should parse errors be inserted at the top of the markdown document, inline beside each failing question, or both?
- Should the tool tolerate additional user edits outside the expected response blocks as long as the blocks remain parseable?
- Should option descriptions be rendered inside the `<user_response>` block or outside it for easier parsing?
- Should a future version preserve the temporary file path for debugging when parsing repeatedly fails?
- Should the tool support a configurable response-block format in the future, or is the markdown checklist contract sufficient?

## Code Locations

- `pi-extensions/extensions/questionnaire.ts`
- `pi-extensions/extensions/README.md`
- `package.json` (extension package exposure)
```
