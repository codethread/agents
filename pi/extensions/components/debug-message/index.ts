import {
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";
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

function getFooterText(scrollOffset: number, visibleLines: number, totalLines: number): string {
	const scrollStatus =
		totalLines > visibleLines
			? `↑↓/PgUp/PgDn scroll • ${scrollOffset + 1}-${Math.min(scrollOffset + visibleLines, totalLines)}/${totalLines} • `
			: "";
	return `${scrollStatus}Ctrl+G open in editor • Ctrl+Enter send to agent • Enter/Esc close`;
}

function showExternalEditorCancelPrompt(
	ctx: Pick<ExtensionContext, "ui">,
	abortController: AbortController,
): Promise<void> {
	return ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		let closed = false;
		function close(): void {
			if (closed) return;
			closed = true;
			abortController.signal.removeEventListener("abort", close);
			done();
		}
		abortController.signal.addEventListener("abort", close, { once: true });
		if (abortController.signal.aborted) close();

		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("External editor is open")), 1, 0));
		container.addChild(
			new Text(theme.fg("dim", "Close the editor to return • Esc cancel editor"), 1, 0),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					abortController.abort();
					close();
				}
			},
		};
	});
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
		const action = await ctx.ui.custom<DebugMessageAction | undefined>((tui, theme, _kb, done) => {
			let scrollOffset = 0;
			let pageSize = 1;

			return {
				render: (width: number) => {
					const header = new Container();
					header.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
					header.addChild(new Text(theme.fg("accent", theme.bold(props.headingText)), 1, 0));
					if (subheadingText) {
						header.addChild(new Text(theme.fg("dim", subheadingText), 1, 0));
					}

					const headerLines = header.render(width);
					const bodyLines = new Markdown(props.markdownBody, 1, 1, mdTheme).render(width);
					const renderFooter = () => {
						const footer = new Container();
						footer.addChild(
							new Text(
								theme.fg("dim", getFooterText(scrollOffset, pageSize, bodyLines.length)),
								1,
								0,
							),
						);
						footer.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
						return footer.render(width);
					};

					pageSize = Math.max(1, tui.terminal.rows - headerLines.length - 2);
					let footerLines = renderFooter();
					pageSize = Math.max(1, tui.terminal.rows - headerLines.length - footerLines.length);
					const maxOffset = Math.max(0, bodyLines.length - pageSize);
					scrollOffset = Math.min(scrollOffset, maxOffset);
					footerLines = renderFooter();

					return [
						...headerLines,
						...bodyLines.slice(scrollOffset, scrollOffset + pageSize),
						...footerLines,
					];
				},
				invalidate: () => {},
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
						return;
					}

					const previousOffset = scrollOffset;
					if (matchesKey(data, "up")) scrollOffset = Math.max(0, scrollOffset - 1);
					else if (matchesKey(data, "down")) scrollOffset += 1;
					else if (matchesKey(data, "pageUp")) scrollOffset = Math.max(0, scrollOffset - pageSize);
					else if (matchesKey(data, "pageDown")) scrollOffset += pageSize;
					else if (matchesKey(data, "home")) scrollOffset = 0;
					else if (matchesKey(data, "end")) scrollOffset = Number.MAX_SAFE_INTEGER;
					if (scrollOffset !== previousOffset) tui.requestRender();
				},
			};
		});

		if (action === "openInEditor") {
			const abortController = new AbortController();
			const editorPromise = openMarkdownInExternalEditor(props.markdownBody, {
				fileNameStem: props.headingText,
				signal: abortController.signal,
			});
			const cancelPromptPromise = showExternalEditorCancelPrompt(ctx, abortController);
			const result = await editorPromise.finally(() => abortController.abort());
			await cancelPromptPromise;
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
