# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-10
**Revision:** External-editor markdown form with compact answer blocks, companion session transcript, and explicit stop handling

## 1. Overview

### Purpose

The questionnaire extension provides a structured-input tool for Pi sessions that need user clarification before proceeding. It accepts one or more multiple-choice questions, renders them into a temporary markdown document, opens that document in the user's configured external editor (`$VISUAL` or `$EDITOR`), parses the completed responses after the editor closes, and returns normalized structured results.

### Goals

- Gather structured user input through one tool.
- Preserve the existing questionnaire input shape, except that `Other` is always available and is no longer configurable per question.
- Reuse the user's editor rather than maintaining a bespoke TUI form.
- Keep answers parseable and machine-usable.
- Support predefined choices plus optional freeform responses.
- Make cancellation, stop, editor, and configuration failures explicit.
- Keep relevant context inside the editable form.
- Give the user access to session context from inside their editor.

### Non-Goals

- Restoring the previous custom tabbed questionnaire UI.
- Persisting questionnaire state across sessions.
- Supporting conditional branching or rich form schemas beyond markdown-rendered option details.
- Parsing arbitrary prose outside designated response blocks.
- Falling back to Pi's inline input editor when no external editor is configured.

## 2. Design Decisions

- **Decision:** Keep one tool for both single- and multi-question flows.
  - **Rationale:** Callers should not need separate tools when only count differs.

- **Decision:** Always include `Other`.
  - **Rationale:** Clarification workflows often need an escape hatch, and removing per-question configuration simplifies the contract.

- **Decision:** Separate verbose option rendering from compact answer parsing.
  - **Rationale:** Agents can provide rich markdown descriptions without making the parser fragile.

- **Decision:** Use a companion transcript file rather than embedding chat history in the questionnaire.
  - **Rationale:** Users can navigate both files using normal editor workflows, especially in Vim-like editors.

- **Decision:** Treat an empty saved questionnaire as explicit stop.
  - **Rationale:** Clearing a buffer is often easier than finding a dedicated cancel control inside a text editor.

## 3. Architecture

<!-- questionnaire-question:architecture -->

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
- [ ] 3. Other:
     </user_response>

````

The user checks exactly one option. If `Other:` is selected, the user writes custom text directly below the checked `Other:` line and before `</user_response>`.

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

Visibility behavior:

- questionnaire stays registered in normal interactive sessions
- subagent child processes set `PI_SUBAGENT=1`
- on `session_start`, headless subagents remove `questionnaire` from active tools before the next prompt is built
- this is a startup-only hide, not a runtime execution guard

The temporary questionnaire directory is removed in a `finally` block.

### Companion transcript file

The tool writes `session-tldr.md` alongside the questionnaire. This file contains the current session's user and assistant messages only, with tool calls, thinking blocks, and other non-text content removed using the same transcript extraction logic as the `tldr` extension.

The transcript is formatted as alternating H1 sections so it is easier to navigate in editors:

```md
# User

Question from the user

# Assistant

Reply from the assistant
````

### Validation retry model

If parsing fails, the tool rewrites the same markdown file with a prepended validation banner and reopens it.

Banner markers:

```md
<!-- questionnaire-errors:start -->

...

<!-- questionnaire-errors:end -->
```

Before adding a fresh banner, any older banner block is stripped. This keeps retries idempotent.

Unlike the initial clean form, the validation banner includes brief instructions:

- check exactly one option by changing `[ ]` to `[x]`
- if selecting `Other`, write custom text directly below the `Other:` line
- save an empty buffer to stop without answering

## 4. Data Model

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
	stopped?: boolean;
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
- `Other` is always rendered as the final answer choice
- predefined option answers include `index`
- custom answers omit `index` and set `wasCustom: true`
- custom answers are parsed from all text after the checked `Other:` line up to `</user_response>`
- if the custom text begins with `Other:`, that prefix is stripped before returning the value

## 5. Interfaces

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

- even hard failures such as missing editor, launch failure, or explicit cancellation are represented as cancelled questionnaire results rather than throwing tool errors

### Parsing contract

Per question:

- the question marker must exist exactly once
- the section must contain exactly one `<user_response>` block inside the compact `### Answer:` area
- exactly one checkbox must be checked
- checked index must be within the rendered option range
- predefined options map back to original `value`/`label`
- `Other` is always available, and when selected, custom text must be non-empty after trimming

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
- explicit stop: render `Stopped`
- success: render one `✓` line per answer using answer ids

Current implementation note:

- cancelled rendering does **not** display the explanatory cancellation/error text from `content`; it only shows `Cancelled` or `Stopped`

## 6. Testing

Automated tests live in:

- `pi-extensions/questionnaire/parser.test.ts`
- `pi-extensions/tldr/summary.test.ts`

Verification is manual plus static:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- runtime validation in Pi for:
  - single-question flow
  - multi-question flow
  - top-level and per-question context rendering
  - verbose markdown option rendering
  - predefined option parsing
  - custom `Other:` parsing
  - `Other:` parsing with duplicated `Other:` prefix in user text
  - validation retries for none/multiple selections
  - validation failure for empty custom text
  - empty-buffer explicit stop handling
  - missing-editor behavior
  - editor cancellation/non-zero exit handling
  - companion transcript formatting and accessibility

## 7. Open Questions

- Should cancelled rendering surface the underlying cancellation reason instead of only `Cancelled`?
- Should validation errors eventually appear inline beside each question as well as in the top banner?
- Should the parser tolerate even more edits outside the response blocks as long as the blocks remain valid?
- Should the tool preserve the temp file for debugging after repeated failures?

## 8. Code Locations

- `pi-extensions/questionnaire/`
- `pi-extensions/questionnaire/parser.ts`
- `pi-extensions/shared/session-transcript.ts`
- `pi-extensions/README.md`
- `package.json`
