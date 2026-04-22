import {
	DynamicBorder,
	getMarkdownTheme,
	type ExtensionAPI,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";

export default function beforeAgentStartInspector(pi: ExtensionAPI) {
	let pendingReport: any | null = null;

	pi.registerCommand("debug-sys-prompt", {
		description: "Show the last captured before_agent_start system prompt details",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			if (!pendingReport) {
				ctx.ui.notify("No system prompt details captured yet.", "warning");
				return;
			}
			await showPromptDetails(pendingReport, ctx);
		},
	});

	pi.on("before_agent_start", (event) => {
		pendingReport = event;
	});
}

async function showPromptDetails(details: any, ctx: ExtensionContext) {
	const output = JSON.stringify(details, null, 2);
	if (!ctx.hasUI) {
		process.stdout.write(`${output}\n`);
		return;
	}

	await ctx.ui.custom((_tui, theme, _kb, done) => {
		const container = new Container();
		const mdTheme = getMarkdownTheme();

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("System prompt details")), 1, 0));
		container.addChild(
			new Text(theme.fg("dim", "hidden from agent • press Enter or Esc to close"), 1, 0),
		);
		container.addChild(
			new Markdown(
				`\n\
${output}`,
				1,
				1,
				mdTheme,
			),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
			},
		};
	});
}
