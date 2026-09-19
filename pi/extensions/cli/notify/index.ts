import { spawn } from "node:child_process";
import path from "node:path";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const DEBUG_NOTIFY_FLAG = "debug-notify";
const TITLE_PREFIX = "agent-ready";
const NOTIFICATION_DELAY = "0ms";
const NOTIFICATION_TIMEOUT_MS = 10_000;
const RESPONSE_PREVIEW_CHARS = 500;

type NotificationContent = {
	title: string;
	message: string;
};

type NotifyResult = "idle" | "sent";
type NotificationSender = (content: NotificationContent) => Promise<void>;

export class SettledNotification {
	private title: string | undefined;
	private response = "";
	private readonly send: NotificationSender;

	constructor(send: NotificationSender) {
		this.send = send;
	}

	arm(title: string): void {
		this.title = title;
		this.response = "";
	}

	captureResponse(response: string): void {
		if (this.title) this.response = response;
	}

	clear(): void {
		this.title = undefined;
		this.response = "";
	}

	isArmed(): boolean {
		return this.title !== undefined;
	}

	async settle(): Promise<NotifyResult> {
		if (!this.title) return "idle";

		const content = {
			title: this.title,
			message: responsePreview(this.response),
		};
		// Consume the request before the external side effect so overlapping settled
		// events cannot send the same one-shot notification twice.
		this.clear();
		await this.send(content);
		return "sent";
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function commandFailure(stdout: string, stderr: string, code: number): string {
	return stderr.trim() || stdout.trim() || `git exited with code ${code}`;
}

export function responsePreview(response: string): string {
	const characters = Array.from(response.trim());
	if (characters.length <= RESPONSE_PREVIEW_CHARS) return characters.join("");
	return `${characters.slice(0, RESPONSE_PREVIEW_CHARS).join("").trimEnd()}…`;
}

export function latestAssistantResponse(messages: AgentEndEvent["messages"]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	return "";
}

async function defaultTitle(pi: ExtensionAPI, cwd: string): Promise<string> {
	const [rootResult, branchResult] = await Promise.all([
		pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			timeout: 5000,
		}),
		pi.exec("git", ["branch", "--show-current"], {
			cwd,
			timeout: 5000,
		}),
	]);

	if (rootResult.code !== 0) {
		throw new Error(commandFailure(rootResult.stdout, rootResult.stderr, rootResult.code));
	}
	if (branchResult.code !== 0) {
		throw new Error(commandFailure(branchResult.stdout, branchResult.stderr, branchResult.code));
	}

	const project = path.basename(rootResult.stdout.trim());
	const branch = branchResult.stdout.trim();
	if (!project) throw new Error("git returned an empty repository root");
	if (!branch) throw new Error("git returned an empty branch name");
	return `${TITLE_PREFIX} ${project}(${branch})`;
}

export function sendCcNotification(content: NotificationContent): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("cc-notify", ["--after", NOTIFICATION_DELAY, content.title], {
			stdio: ["pipe", "ignore", "pipe"],
			timeout: NOTIFICATION_TIMEOUT_MS,
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.stdin.on("error", reject);
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(stderr.trim() || `cc-notify exited with ${signal ?? `code ${code}`}`));
		});
		child.stdin.end(content.message);
	});
}

function notifyFailure(ctx: Pick<ExtensionContext, "hasUI" | "ui">, error: unknown): void {
	const message = `/notify failed: ${getErrorMessage(error)}`;
	if (ctx.hasUI) ctx.ui.notify(message, "error");
	else process.stderr.write(`${message}\n`);
}

export function createNotifyExtension(send: NotificationSender = sendCcNotification) {
	return function notifyExtension(pi: ExtensionAPI) {
		const notification = new SettledNotification(send);

		pi.registerFlag(DEBUG_NOTIFY_FLAG, {
			description: "Print one-shot settled notification configuration and exit",
			type: "boolean",
			default: false,
		});

		pi.registerCommand("notify", {
			description: "Notify you when the current agent run settles",
			handler: async (args, ctx) => {
				try {
					const suffix = args.trim();
					const title = suffix ? `${TITLE_PREFIX} ${suffix}` : await defaultTitle(pi, ctx.cwd);
					notification.arm(title);
					ctx.ui.notify(`Notification armed: ${title}`, "info");
				} catch (error) {
					notifyFailure(ctx, error);
				}
			},
		});

		pi.on("session_start", () => {
			notification.clear();
			if (pi.getFlag(DEBUG_NOTIFY_FLAG) !== true) return;

			process.stdout.write(
				[
					"notify extension loaded",
					`command: cc-notify --after ${NOTIFICATION_DELAY} "${TITLE_PREFIX} <project>(<branch>)"`,
					`body: first ${RESPONSE_PREVIEW_CHARS} characters of the settled assistant response`,
					"delivery: immediate on next agent_settled event, one shot",
				].join("\n") + "\n",
			);
			process.exit(0);
		});

		pi.on("agent_end", (event) => {
			notification.captureResponse(latestAssistantResponse(event.messages));
		});

		pi.on("agent_settled", async (_event, ctx) => {
			try {
				await notification.settle();
			} catch (error) {
				notifyFailure(ctx, error);
			}
		});
	};
}

export default createNotifyExtension();
