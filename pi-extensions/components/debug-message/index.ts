import {
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";
import { openMarkdownInExternalEditor } from "./external-editor.js";

type DebugMessageAction = "close" | "openInEditor" | "sendToAgent";

/**
 * Renders a transient, read-only markdown debug panel for extension-generated output.
 *
 * Use this for hidden-from-agent `/debug-*` and other inspection surfaces where the user
 * should be able to review markdown, open that markdown in an external editor for easier
 * reading, or intentionally send the markdown body into the conversation as a user message.
 * The editor-open action is read-only from Pi's perspective: the original markdown body is
 * preserved and any edits made in the external editor are ignored on return.
 */
export interface DebugMessageProps {
	headingText: string;
	subheadingText?: string;
	markdownBody: string;
	hiddenFromAgentByDefault?: boolean;
	sendMarkdownToAgent: (markdownBody: string) => Promise<void> | void;
}

function getSubheadingText({
	subheadingText,
	hiddenFromAgentByDefault = true,
}: Pick<DebugMessageProps, "subheadingText" | "hiddenFromAgentByDefault">): string {
	const parts = [
		subheadingText?.trim(),
		hiddenFromAgentByDefault ? "hidden from agent" : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.join(" • ");
}

function getFooterText(): string {
	return "Ctrl+G open in editor • Ctrl+Enter send to agent • Enter/Esc close";
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function showDebugMessage(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	props: DebugMessageProps,
): Promise<void> {
	if (!ctx.hasUI) return;

	const subheadingText = getSubheadingText(props);
	const mdTheme = getMarkdownTheme();

	for (;;) {
		const action = await ctx.ui.custom<DebugMessageAction | undefined>((_tui, theme, _kb, done) => {
			const container = new Container();

			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold(props.headingText)), 1, 0));
			if (subheadingText) {
				container.addChild(new Text(theme.fg("dim", subheadingText), 1, 0));
			}
			container.addChild(new Markdown(props.markdownBody, 1, 1, mdTheme));
			container.addChild(new Text(theme.fg("dim", getFooterText()), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (matchesKey(data, "ctrl+g")) {
						done("openInEditor");
						return;
					}
					if (matchesKey(data, "ctrl+enter")) {
						done("sendToAgent");
						return;
					}
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
						done("close");
					}
				},
			};
		});

		if (action === "openInEditor") {
			const result = await openMarkdownInExternalEditor(props.markdownBody, {
				fileNameStem: props.headingText,
			});
			if (!result.ok) {
				ctx.ui.notify(result.message, result.level);
			}
			continue;
		}

		if (action === "sendToAgent") {
			try {
				await props.sendMarkdownToAgent(props.markdownBody);
				ctx.ui.notify("Debug content sent to agent", "info");
				return;
			} catch (error) {
				ctx.ui.notify(getErrorMessage(error), "error");
				continue;
			}
		}

		return;
	}
}
