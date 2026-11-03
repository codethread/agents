# Live questionnaires

Investigate the problem first. Reduce it to the fewest decisions that change the next step. Explain each choice in ordinary language. Give each recommendation a brief reason and its main tradeoff, and include a way to disagree or discuss. Leave every control unanswered so agreement is deliberate.

Use this workflow while you remain active with the user. The bundled scripts use Python 3 and Bash; the return contract is a local Markdown file. Submission records answers only.

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

Use the receipt's exact `answerPath`, never a path inferred from the title:

```sh
python3 <skill-dir>/questionnaire.py wait /tmp/rich-response-server/questionnaires/<id>/answers.md --timeout 60
```

Run this through the active agent's background/yielding shell operation. The process waits internally; there is no need for repeated model-driven file checks.

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

The default timeout is 60 seconds; `--timeout 0` is an immediate check. A timeout is not an answer or agreement. A completed file can also be read with `cat` and remains readable after the wait returns.

The answer file appears atomically after explicit Submit. It includes the title, questionnaire identity, question wording, human-readable choice labels and any free text/notes. Empty optional questions are marked. Success appears in the browser only after saving. Retrying identical answers succeeds; differing answers cannot overwrite a completed submission. Create a fresh questionnaire if the user wants to revise their answers.

## Validate the interaction

Use a separate synthetic questionnaire for testing. Verify browser submission, the saved Markdown, and the waiting command before publishing a fresh unanswered questionnaire for the user. Never submit the user's live form on their behalf.

The server uses plain HTTP on fixed port `8765`, reachable on the LAN and directly through Tailscale. It discovers and verifies its own Tailscale address without modifying Serve, Funnel, login state or network policy. The host and phone must be connected to Tailscale, the host must allow incoming connections, and existing access rules must allow that port. If the receipt reports `shields-up`, explain the device-wide setting to the user; a successful self-probe does not override it. A successful local probe does not establish off-network phone access; verify that separately. The bookmark page lists the 20 most recently published documents, including questionnaire submission status. Anyone who can reach the service can discover those links and submit unanswered forms; use a trusted LAN/tailnet. Answers stay on disk and have no HTTP download route. Keep the originating agent active; the file does not wake an ended session. Temporary files last until local cleanup or reboot; this is not durable storage.
