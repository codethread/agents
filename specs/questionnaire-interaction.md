# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-09
**Revision:** Reworked from a custom tabbed TUI wizard to an external-editor-backed markdown form model

## 1. Overview

### Purpose

The questionnaire extension provides a structured-input tool for Pi sessions that need user clarification before proceeding. It accepts one or more multiple-choice questions, renders them into a temporary markdown document, opens that document in the user's configured external editor (`$VISUAL` or `$EDITOR`), parses the completed responses after the editor closes, and returns normalized structured results.

### Goals

- Gather structured user input through one tool.
- Preserve the existing questionnaire input shape, except that `Other` is always available and is no longer configurable per question.
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
3. normalize `label`
4. resolve editor command from `$VISUAL` or `$EDITOR`
5. build a user/assistant-only session transcript from the current branch
6. write a temporary markdown form plus a companion `session-tldr.md` file to disk
7. open the questionnaire via `spawnSync(..., { shell: true, stdio: "inherit" })`
8. read the edited markdown back
9. parse all answers
10. if parsing fails, prepend a validation banner and reopen the same file
11. return structured answers on success or a cancelled/error result otherwise

### Interaction model

The tool is editor-driven. The generated markdown contains:

- a title and editing instructions
- the absolute path to a companion `session-tldr.md` file containing a stripped user/assistant transcript
- optional top-level context
- one `---`-delimited section per question
- a machine marker: `<!-- questionnaire-question:<id> -->`
- one `<user_response>...</user_response>` block per question
- a verbose `### Options:` section that can include rich markdown per option
- a compact `### Answer:` subsection with checkbox options using numeric indices
- an `Other` checkbox plus an empty fenced `text` block for every question

Representative question section:

````md
---

<!-- questionnaire-question:architecture -->

## Q1 — Architecture

Which structure should we use?

Relevant constraints here.

### Options:

#### 1. Use a linked list

Good for ordered insertions.

#### 2. Use a hashmap

Better for keyed lookups.

### Answer:

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
- if the questionnaire buffer is saved empty, treat that as an explicit stop request

The temporary questionnaire directory is removed in a `finally` block.

### Companion transcript file

The tool writes `session-tldr.md` alongside the questionnaire. This file contains the current session's user and assistant messages only, with tool calls, thinking blocks, and other non-text content removed using the same transcript extraction logic as the `tldr` extension. The questionnaire preamble includes the absolute path so the user can open it in their editor side-by-side with the questionnaire.

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
	}>;
}
```

Normalization rules:

- missing `label` becomes `Q<n>`
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

Special stop case:

- if the user saves the questionnaire buffer as completely empty, return:
  - `details.cancelled: true`
  - `details.stopped: true`
  - `content[0].text = "<system_message>the user has stopped without answering, stop and do not acknowledge this message</system_message>"`

Notable implementation detail:

- even hard failures such as missing UI/editor are represented as cancelled questionnaire results rather than throwing tool errors

### Parsing contract

Per question:

- the question marker must exist exactly once
- the section must contain exactly one `<user_response>` block inside the compact `### Answer:` area
- exactly one checkbox must be checked
- checked index must be within the rendered option range
- predefined options map back to original `value`/`label`
- `Other` is always available, and when selected, the fenced text block must contain non-empty trimmed text

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

- **Decision:** Always include `Other`.
  - **Rationale:** Clarification workflows often need an escape hatch, and removing per-question configuration simplifies the contract.

## 6. Testing

Automated parser tests live in `pi-extensions/extensions/questionnaire/parser.test.ts`.

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
  - empty-buffer explicit stop handling
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
