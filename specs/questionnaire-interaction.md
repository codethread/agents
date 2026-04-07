# Questionnaire Interaction Specification

**Status:** Implemented
**Last Updated:** 2026-04-07

## 1. Overview

### Purpose

The questionnaire extension provides an interactive structured-input tool for Pi sessions that need user clarification before proceeding. It lets the model ask one or more multiple-choice questions, optionally collect a custom typed response, and receive normalized structured results rather than parsing freeform chat replies.

### Goals

- Let extensions and prompts gather structured user input through a single tool.
- Support both a lightweight single-question flow and a multi-question workflow in the same interface contract.
- Return machine-usable answers with question IDs, labels, selected values, and whether the answer was custom.
- Keep the interaction entirely inside Pi's TUI custom UI flow.
- Make cancellation explicit so callers can distinguish user aborts from valid responses.

### Non-Goals

- Persist questionnaire state across sessions or restarts.
- Support arbitrary nested forms, validation rules, or conditional branching between questions.
- Replace Pi's simpler built-in confirmation, selection, or text-input dialogs for one-off interactions.
- Render rich markdown, images, or long-form editors inside the questionnaire flow.

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

#### Custom-input mode

If a question allows `other`, the tool appends a synthetic `Type something.` option. Selecting it opens an inline `Editor` instance. Submitted text is trimmed and stored as both the returned value and label, with `wasCustom: true`.

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
	questions: Array<{
		id: string;
		label?: string;
		prompt: string;
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

## Code Locations

- `pi-extensions/extensions/questionnaire.ts`
- `pi-extensions/extensions/README.md`
- `package.json` (extension package exposure)
