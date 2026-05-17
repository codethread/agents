/**
 * Wrap an escape sequence in tmux DCS passthrough.
 * tmux requires ESC bytes inside the payload to be doubled.
 */
export function wrapTmuxPassthrough(sequence: string): string {
	const escaped = sequence.split("\x1b").join("\x1b\x1b");
	return `\x1bPtmux;${escaped}\x1b\\`;
}
