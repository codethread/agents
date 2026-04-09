# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-08
**Revision:** Reworked from a custom tabbed TUI wizard to an external-editor-backed markdown form model

## 1. Overview

### Purpose

The questionnaire extension provides a structured-input tool for Pi sessions that need user clarification before proceeding. It accepts one or more multiple-choice questions, renders them into a temporary markdown document, opens that document in the user's configured external editor (`$VISUAL` or `$EDITOR`), parses the completed responses after the editor closes, and returns normalized structured results.

### Goals

- Gather structured user input through one tool.
- Preserve the existing questionnaire input shape.
- Reuse the user's editor rather than maintaining a bespoke TUI form.
- Keep answers parseable and machine-usable.
- Support predefined choices plus optional freeform responses.
- Make cancellation/editor/configuration failures explicit.
- Keep relevant context inside the editable form.

### Non-Goals

- Restoring the previous custom tabbed questionnaire UI.
- Persisting questionnaire state across sessions.
- Supporting conditional branching or rich form schemas.
- Parsing arbitrary prose outside designated response blocks.
- Falling back to Pi's inline input editor when no external editor is configured.

## 2. Architecture

Implementation lives in:

- `pi-extensions/extensions/questionnaire.ts`

The extension registers a `questionnaire` tool with a TypeBox schema. Execution flow:

1. require interactive UI via `ctx.hasUI`
2. require at least one question
3. normalize `label` and `allowOther`
4. resolve editor command from `$VISUAL` or `$EDITOR`
5. write a temporary markdown form to disk
6. open it via `spawnSync(..., { shell: true, stdio: "inherit" })`
7. read the edited markdown back
8. parse all answers
9. if parsing fails, prepend a validation banner and reopen the same file
10. return structured answers on success or a cancelled/error result otherwise

### Interaction model

The tool is editor-driven. The generated markdown contains:

- a title and editing instructions
- optional top-level context
- one `---`-delimited section per question
- a machine marker: `<!-- questionnaire-question:<id> -->`
- one `<user_response>...</user_response>` block per question
- checkbox options with numeric indices
- when `allowOther` is enabled, an `Other` checkbox plus an empty fenced `text` block

Representative question section:

````md
---

<!-- questionnaire-question:architecture -->

## Q1 — Architecture

Which structure should we use?

Relevant constraints here.

<user_response>

- [ ] 1. Use a linked list
- [ ] 2. Use a hashmap
- [ ] 3. Other

```text

```

</user_response>
````

The user checks exactly one option. If `Other` is selected, the user fills the fenced block and exits the editor successfully.

### Editor execution

Editor resolution order:

1. `$VISUAL`
2. `$EDITOR`

Failure behavior:

- no editor configured → cancelled result with explanatory text
- editor launch error → cancelled result
- non-zero editor exit code → cancelled result
- signal termination → cancelled result mentioning the signal

The temporary questionnaire directory is removed in a `finally` block.

### Validation retry model

If parsing fails, the tool rewrites the same markdown file with a prepended validation banner and reopens it.

Banner markers:

```md
<!-- questionnaire-errors:start -->

...

<!-- questionnaire-errors:end -->
```

Before adding a fresh banner, any older banner block is stripped. This keeps retries idempotent.

## 3. Data Model

Implementation-local types:

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
```

Validation helper shapes:

```ts
interface ParseError {
	questionId: string;
	questionLabel: string;
	message: string;
}

interface ParseResult {
	answers: Answer[];
	errors: ParseError[];
}
```

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
- missing context sections are omitted from the markdown
- predefined option answers include `index`
- custom answers omit `index` and set `wasCustom: true`

## 4. Interfaces

### Tool registration

The extension exposes:

- tool name: `questionnaire`
- label: `Questionnaire`
- parameters: `QuestionnaireParams`

### Execution contract

Success returns:

- `details.cancelled: false`
- normalized `questions`
- parsed `answers`
- `content` lines formatted as either:
  - `<label>: user selected: <index>. <option label>`
  - `<label>: user wrote: <custom text>`

Failure/cancellation returns:

- `details.cancelled: true`
- empty `answers`
- explanatory text in `content`

Notable implementation detail:

- even hard failures such as missing UI/editor are represented as cancelled questionnaire results rather than throwing tool errors

### Parsing contract

Per question:

- the question marker must exist exactly once
- the section must contain exactly one `<user_response>` block
- exactly one checkbox must be checked
- checked index must be within the rendered option range
- predefined options map back to original `value`/`label`
- when `Other` is selected, the fenced text block must contain non-empty trimmed text

Detected parse failures include:

- missing question marker section
- duplicate question markers
- missing or multiple response blocks
- no selected option
- multiple selected options
- selected option out of range
- `Other` selected with empty custom text

### Rendering contract

`renderCall(...)`:

- shows question count
- shows question labels or ids, width-truncated

`renderResult(...)`:

- partial: render markdown when partial text exists, else `Updating...`
- cancelled: render `Cancelled`
- success: render one `✓` line per answer using answer ids

Current implementation note:

- cancelled rendering does **not** display the explanatory cancellation/error text from `content`; it only shows `Cancelled`

## 5. Design Decisions

- **Decision:** Keep one tool for both single- and multi-question flows.
  - **Rationale:** Callers should not need separate tools when only count differs.

- **Decision:** Preserve the existing input shape.
  - **Rationale:** Existing prompts/extensions can keep using the tool without migration.

- **Decision:** Move interaction to the user's external editor.
  - **Rationale:** Markdown editing is familiar and avoids a large bespoke TUI state machine.

- **Decision:** Use stable HTML comment markers and `<user_response>` tags.
  - **Rationale:** Human-editable markdown remains parseable and retryable.

- **Decision:** Retry in place with a prepended validation banner.
  - **Rationale:** The user can fix the same form without re-entering all answers.

- **Decision:** Keep `allowOther` enabled by default.
  - **Rationale:** Clarification workflows often need an escape hatch.

## 6. Testing

There are currently no automated tests for the questionnaire flow.

Verification is manual plus static:

- `npm run lint`
- `npm run typecheck`
- runtime validation in Pi for:
  - single-question flow
  - multi-question flow
  - top-level and per-question context rendering
  - predefined option parsing
  - custom `Other` parsing
  - validation retries for none/multiple selections
  - validation failure for empty custom text
  - missing-editor behavior
  - editor cancellation/non-zero exit handling

## 7. Open Questions

- Should cancelled rendering surface the underlying cancellation reason instead of only `Cancelled`?
- Should validation errors eventually appear inline beside each question as well as in the top banner?
- Should the parser tolerate more user edits outside the response blocks as long as the blocks remain valid?
- Should the tool preserve the temp file for debugging after repeated failures?

## Code Locations

- `pi-extensions/extensions/questionnaire.ts`
- `pi-extensions/extensions/README.md`
- `package.json`
