# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-07
**Revision:** Added contextual briefing support (top-level and per-question context fields)

## 1. Overview

### Purpose

The questionnaire extension provides an interactive structured-input tool for Pi sessions that need user clarification before proceeding. It lets the model ask one or more multiple-choice questions, optionally collect a custom typed response, and receive normalized structured results rather than parsing freeform chat replies.

### Goals

- Let extensions and prompts gather structured user input through a single tool.
- Support both a lightweight single-question flow and a multi-question workflow in the same interface contract.
- Return machine-usable answers with question IDs, labels, selected values, and whether the answer was custom.
- Keep the interaction entirely inside Pi's TUI custom UI flow.
- Make cancellation explicit so callers can distinguish user aborts from valid responses.
- Allow the model to attach contextual briefings at two levels — an overview visible across all tabs, and per-question detail visible only on the active tab — so users can make informed decisions without leaving the questionnaire.

### Non-Goals

- Persist questionnaire state across sessions or restarts.
- Support arbitrary nested forms, validation rules, or conditional branching between questions.
- Replace Pi's simpler built-in confirmation, selection, or text-input dialogs for one-off interactions.
- Render images or long-form editors inside the questionnaire flow.
- Parse or linkify file references embedded in context strings; they are rendered as plain text for the user to follow in their own editor.

## 2. Architecture

The domain is implemented by a single extension entrypoint:

- `pi-extensions/extensions/questionnaire.ts`

The extension registers a `questionnaire` custom tool with a TypeBox parameter schema. At execution time it:

1. validates that interactive UI is available
2. normalizes question defaults (`label`, `allowOther`)
3. opens a `ctx.ui.custom(...)` TUI session
4. drives a local state machine for tab selection, option selection, and optional text-entry mode
5. returns a structured result payload suitable for both LLM consumption and TUI rendering

### Interaction modes

#### Single-question mode

When only one question is supplied, the tool presents a simple vertical option list. Selecting an option immediately submits the tool result. If `allowOther` is enabled, the final option switches into text-entry mode.

#### Multi-question mode

When multiple questions are supplied, the tool adds a tab bar:

- one tab per question
- one final submit tab
- answered questions are visually marked
- the user can move between tabs with Tab or arrow keys

Answers are stored incrementally in memory and the final submit tab summarizes collected responses before submission.

#### Contextual briefing

The tool supports optional context at two levels:

- **Top-level context** (`context` on the root params): An overview briefing rendered between the top rule and the tab bar (or question prompt in single-question mode). It is always visible regardless of which tab is active. Intended for a terse problem statement (≤10 lines) with optional vim-style file references (e.g. `path/to/file.ts:42-60`).

- **Per-question context** (`context` on individual questions): Detail relevant to the active question, rendered between the question prompt and the options list. Only the active tab's context is shown. Useful for pointing the user at specific code locations or design constraints that inform the choice.

Both are optional plain strings containing markdown. When absent, the corresponding section is simply omitted with no placeholder. Context blocks are rendered using Pi's `Markdown` component with a muted default text style to maintain visual hierarchy below the interactive prompt and options. This means inline formatting (`**bold**`, `` `code` ``), lists, code blocks, and other standard markdown features are rendered with proper styling.

#### Custom-input mode

If a question allows `other`, the tool appends a synthetic `Type something.` option. Selecting it opens an inline `Editor` instance. Submitted text is trimmed and stored as both the returned value and label, with `wasCustom: true`.

While in custom-input mode, pressing `Ctrl+G` opens the current text in `$VISUAL` or `$EDITOR` (the standard external editor). The TUI is paused while the editor runs; on exit the file contents are read back into the inline editor. The hint line shows the `Ctrl+G` shortcut only when an external editor is detected in the environment. This uses the same `app.editor.external` keybinding as Pi's main editor.

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
- missing `context` (top-level or per-question) results in that section being omitted from rendering
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

Cancellation or non-interactive execution returns:

- `details.cancelled: true`
- explanatory text in `content`

### Rendering contract

The extension customizes both:

- `renderCall(...)` — compact summary showing question count and labels
- `renderResult(...)` — answer-oriented summary with explicit cancelled state

Inside the custom TUI flow, keyboard behavior is:

- `↑` / `↓` move option selection
- `←` / `→` and `Tab` / `Shift+Tab` move between tabs in multi-question mode
- `Enter` confirms the current selection or submits typed input
- `Esc` cancels the current text-entry mode or the full questionnaire
- `Ctrl+G` opens external editor (`$VISUAL`/`$EDITOR`) when in text-entry mode

### Visual hierarchy

The render layout from top to bottom:

1. Top rule (accent)
2. Top-level context block with `CONTEXT` header (muted/dimmed) — if provided
3. Tab bar — multi-question mode only
4. Question prompt (primary text color)
5. Per-question context block (muted/dimmed) — if provided for active question
6. Options list (interactive, accent on selected)
7. Help line (dim)
8. Bottom rule (accent)

## 5. Design Decisions

- **Decision:** Use one tool for both single and multi-question flows.
  - **Rationale:** The LLM should not need to choose between separate tools when the only difference is question count.

- **Decision:** Default `allowOther` to enabled.
  - **Rationale:** Clarification workflows frequently need an escape hatch when none of the predefined options match user intent.

- **Decision:** Return both `value` and `label` for answers.
  - **Rationale:** Callers often need a stable programmatic value while still being able to render the user-facing label in summaries.

- **Decision:** Keep all questionnaire state ephemeral and in-memory.
  - **Rationale:** The tool is intended for turn-local clarification, not as a resumable form engine.

- **Decision:** Mark cancellation in structured details instead of relying only on text.
  - **Rationale:** Downstream logic and custom result renderers need an unambiguous branch condition.

- **Decision:** Context fields are plain strings, not structured objects.
  - **Rationale:** Keeps the schema simple. File references are embedded inline using vim-style notation (e.g. `path/to/file.ts:42`) which is familiar to developers and doesn't require special parsing.

- **Decision:** Top-level context is always visible; per-question context switches with tabs.
  - **Rationale:** The overview briefing orients the user across all questions. Per-question detail is only relevant to the active choice and would clutter the display if all were shown simultaneously.

- **Decision:** Context blocks render in muted/dimmed style.
  - **Rationale:** Maintains visual hierarchy — the interactive prompt and options must remain the primary focus. Context is reference material, not the call-to-action.

## 6. Testing

Current verification is manual and static:

- `npm run typecheck` validates the extension against the repo TypeScript configuration.
- `npm run lint` validates code style and basic correctness.
- Runtime verification happens by loading the extension in Pi and exercising:
  - single-question selection
  - multi-question tab navigation
  - custom text entry
  - submit-tab confirmation
  - cancellation from normal and input modes

There are currently no automated tests for the questionnaire TUI interaction flow.

## 7. Open Questions

- Should future versions support per-question validation for custom typed answers?
- Should questions be able to disable freeform answers by default at the tool level instead of per-question only?
- Should the final rendered result prefer question labels over IDs everywhere for easier human scanning?
- Should context blocks support collapsing/expanding for very long briefings?
- Should file references in context be syntax-highlighted or linkified in future TUI versions?

## Code Locations

- `pi-extensions/extensions/questionnaire.ts`
- `pi-extensions/extensions/README.md`
- `package.json` (extension package exposure)
