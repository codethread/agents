# Live questionnaires

Investigate the problem first. Reduce it to the fewest decisions that change the next step. Explain each choice in ordinary language. Give each recommendation a brief reason and its main tradeoff, and include a way to disagree or discuss. Leave every control unanswered so agreement is deliberate.

Use this workflow while you remain active with the user. The bundled scripts use Python 3 and Bash; the return contract is a local Markdown file. Submission records answers only.

Use the `render` and `wait` commands documented below directly. Their arguments, options, outputs and exit handling are included here; consult `--help` only when you need usage outside this workflow.

## Author and publish

Write a body fragment to a temporary file. Use the existing rich-response primitives for context and the following semantic form convention:

```html
<p>We need to agree on the first version before continuing.</p>
<form class="questionnaire">
	<fieldset>
		<legend>How should we proceed?</legend>
		<p>A small first version lets us try the interaction now.</p>
		<label
			><input type="radio" name="direction" value="small" required /> Start small
			<span class="badge">Recommended</span>
			<small>Learn from real use sooner; extra features wait.</small>
		</label>
		<label
			><input type="radio" name="direction" value="discuss" />
			Discuss the scope first
		</label>
		<label>Why? (optional)<textarea name="direction-notes" data-notes></textarea></label>
	</fieldset>
	<fieldset>
		<legend>What matters most? Choose any.</legend>
		<label><input type="checkbox" name="priorities" value="phone" />Easy phone use</label>
		<label><input type="checkbox" name="priorities" value="readable" />Readable answers</label>
	</fieldset>
	<fieldset>
		<legend>Anything else?</legend>
		<label>Optional thoughts<textarea name="thoughts"></textarea></label>
	</fieldset>
</form>
```

- One `form.questionnaire`, one fieldset per question, one legend with its wording.
- Wrap each control in a label. Use the same `name` within a choice group and distinct `value`s for its choices. Names start with a letter and contain letters, digits, `_` or `-`; each question and notes field needs a unique name.
- Each fieldset contains one radio group, one checkbox group, or one textarea. It may also have one optional textarea marked `data-notes`.
- Use `required` for radio/text questions, or `data-required` on the fieldset to require at least one checkbox. Otherwise a question is optional; say so in its wording.
- Keep controls blank and enabled. Recommendations are text/badges, not `checked` inputs.
- The runtime adds Submit, status messages, styling and submission handling. Author only the fragment, without your own submit button, form action, scripts or styles.

Create a quoted heredoc (`<<'HTML'`) as in the main skill, then run:

```sh
python3 <skill-dir>/questionnaire.py render "Workshop title" < /tmp/workshop-body.html > /tmp/workshop-receipt.json
```

The command validates, publishes, opens the local URL and prints a JSON receipt with `id`, `htmlPath`, `answerPath`, `waitCommand`, and the exact `localUrl`, `lanUrl`, and `tailscaleUrl` for this questionnaire. It also includes `localHomeUrl`, `lanHomeUrl`, and `tailscaleHomeUrl` for the stable recent-documents page. `--no-open` suppresses opening the browser. Present all available document links and the Tailscale bookmark; copy the URLs from the receipt. If `tailscaleUrl` is null, report `tailscaleUnavailableReason` with the local/LAN links instead of guessing an address. Every render creates a fresh identity and path, even when the title is reused; earlier answers cannot complete a new questionnaire.

If the publisher reports a different server version, run its printed `server.py restart` command. It verifies the running rich-response service before restarting it and preserves published documents and answers. An unrelated listener is refused.

## Wait and read

Execute the receipt's `waitCommand` unchanged through the active agent's background/yielding shell operation. It already contains the absolute script path, this questionnaire's exact `answerPath` and a 60-second timeout. The process waits internally; there is no need for repeated model-driven file checks.

```text
Wait returns
  |
  +-- exit 0 --> Markdown on stdout --> read every answer; acknowledge receipt
  |
  +-- exit 2 --> pending on stderr --> keep the user link; resume the same wait
  |
  +-- other --> error on stderr ----> resolve the error before continuing
```

After reading submitted answers, immediately acknowledge to the user that you have received and read them, before analyzing or formulating your substantive response. Then discuss disagreements or continue only work already authorized by the user.

`--timeout` accepts a finite, nonnegative number of seconds and defaults to 60; `--timeout 0` is an immediate check. A timeout is not an answer or agreement. A completed file can also be read with `cat` and remains readable after the wait returns.

The answer file appears atomically after explicit Submit. It includes the title, questionnaire identity, question wording, human-readable choice labels and any free text/notes. Empty optional questions are marked. Success appears in the browser only after saving. Retrying identical answers succeeds; differing answers cannot overwrite a completed submission. Create a fresh questionnaire if the user wants to revise their answers.
