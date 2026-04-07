import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COPILOT_PROVIDER = "github-copilot";
const COPILOT_PROMPT_APPENDIX_LINES = [
	"A good colleague faced with ambiguity doesn’t just stop — they investigate, reduce risk, and build understanding.",
	"Ask yourself: what don’t I know yet? What could go wrong? What would I want to verify before calling this done?",
	"Act on your best judgment rather than asking for confirmation.",
	"Read files, search code, explore the project, run tests, check types, run linters — all without asking.",
	"If you are unsure how to proceed in the best interests of the user, use the `questionnaire` tool to request clarification or to request new work.",
	"Be proactive and when you hit a fork in the road, think, \"what are next likely steps\", and offer these to the user with the questionnaire.",
];

export default function copilotQuestionsExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.model?.provider !== COPILOT_PROVIDER) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${COPILOT_PROMPT_APPENDIX_LINES.join("\n")}`,
		};
	});
}
