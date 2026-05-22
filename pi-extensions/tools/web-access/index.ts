import { Readability } from "@mozilla/readability";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_SEARCH_RESULTS = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const DEBUG_WEB_ACCESS_FLAG = "debug-web-access";

const WebSearchParams = Type.Object({
	query: Type.String({ description: "Search query to send to Exa." }),
	numResults: Type.Optional(
		Type.Integer({
			description: "Maximum number of Exa results. Defaults to 5.",
			minimum: 1,
			maximum: 20,
			default: DEFAULT_SEARCH_RESULTS,
		}),
	),
});

type WebSearchParams = Static<typeof WebSearchParams>;

const FetchContentParams = Type.Object({
	url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
});

type FetchContentParams = Static<typeof FetchContentParams>;

interface ExaSearchResponse {
	results?: Array<{
		title?: string;
		url?: string;
		author?: string;
		publishedDate?: string;
		text?: string;
	}>;
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publishedDate?: string;
}

interface FetchedContent {
	url: string;
	title: string;
	content: string;
	contentType: string;
}

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

function getExaApiKey(): string {
	const key = process.env.EXA_API_KEY?.trim();
	if (!key) throw new Error("EXA_API_KEY is required for web_search.");
	return key;
}

function combineSignal(signal?: AbortSignal, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function asErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ok(text: string, details: unknown) {
	return { content: [{ type: "text" as const, text }], details };
}

function fail(message: string, details?: unknown) {
	return {
		content: [{ type: "text" as const, text: `Error: ${message}` }],
		details,
		isError: true,
	};
}

function cleanText(text: string): string {
	return text
		.replace(/\n{3,}/g, "\n\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function formatSearchResults(results: SearchResult[]): string {
	if (!results.length) return "No results.";
	return results
		.map((result, index) => {
			const lines = [`${index + 1}. ${result.title}`, result.url];
			if (result.publishedDate) lines.push(`Published: ${result.publishedDate}`);
			if (result.snippet) lines.push(result.snippet);
			return lines.join("\n");
		})
		.join("\n\n");
}

function mapExaResults(response: ExaSearchResponse): SearchResult[] {
	return (response.results ?? [])
		.filter((result): result is NonNullable<ExaSearchResponse["results"]>[number] & { url: string } => {
			return typeof result.url === "string" && result.url.trim().length > 0;
		})
		.map((result, index) => ({
			title: result.title?.trim() || `Result ${index + 1}`,
			url: result.url,
			snippet: cleanText(result.text ?? "").slice(0, 1_500),
			publishedDate: result.publishedDate,
		}));
}

async function searchExa(params: WebSearchParams, signal?: AbortSignal): Promise<SearchResult[]> {
	const response = await fetch(EXA_SEARCH_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": getExaApiKey(),
		},
		body: JSON.stringify({
			query: params.query,
			numResults: params.numResults ?? DEFAULT_SEARCH_RESULTS,
			contents: { text: { maxCharacters: 1500 } },
		}),
		signal: combineSignal(signal),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Exa search failed (${response.status}): ${body || response.statusText}`);
	}

	return mapExaResults((await response.json()) as ExaSearchResponse);
}

function assertHttpUrl(rawUrl: string): URL {
	const url = new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Only http/https URLs are supported: ${rawUrl}`);
	}
	return url;
}

async function readResponseText(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length") ?? 0);
	if (contentLength > MAX_FETCH_BYTES) {
		throw new Error(`Response too large (${contentLength} bytes). Limit: ${MAX_FETCH_BYTES} bytes.`);
	}
	return response.text();
}

function htmlToMarkdown(html: string, url: string): FetchedContent {
	const { document } = parseHTML(html);
	const parsed = new Readability(document).parse();
	if (!parsed?.content) throw new Error("Unable to extract readable HTML content.");
	return {
		url,
		title: parsed.title || new URL(url).hostname,
		content: cleanText(turndown.turndown(parsed.content)),
		contentType: "text/html",
	};
}

async function fetchContent(rawUrl: string, signal?: AbortSignal): Promise<FetchedContent> {
	const url = assertHttpUrl(rawUrl);
	const response = await fetch(url, {
		headers: {
			accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.8",
			"user-agent": "Mozilla/5.0 (compatible; Pi web_access)",
		},
		signal: combineSignal(signal),
	});
	if (!response.ok) throw new Error(`Fetch failed (${response.status}): ${response.statusText}`);

	const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "text/plain";
	const body = await readResponseText(response);
	if (contentType === "text/html" || body.trimStart().toLowerCase().startsWith("<!doctype html") || body.includes("<html")) {
		return htmlToMarkdown(body, url.toString());
	}

	return {
		url: url.toString(),
		title: url.hostname,
		content: cleanText(body),
		contentType,
	};
}

function getTextContent(result: { content?: Array<{ type: string; text?: string }> }): string {
	return result.content?.find((item) => item.type === "text")?.text ?? "";
}

async function runDebug(command: string, signal?: AbortSignal): Promise<void> {
	const [action, ...rest] = command.trim().split(/\s+/);
	if (action === "search") {
		const results = await searchExa({ query: rest.join(" "), numResults: 3 }, signal);
		process.stdout.write(`${JSON.stringify(results, null, "\t")}\n`);
		process.exit(0);
	}
	if (action === "fetch") {
		const result = await fetchContent(rest.join(" "), signal);
		process.stdout.write(`${JSON.stringify(result, null, "\t")}\n`);
		process.exit(0);
	}
	throw new Error(`Unknown ${DEBUG_WEB_ACCESS_FLAG} command. Use: search <query> or fetch <url>`);
}

export default function webAccess(pi: ExtensionAPI) {
	pi.registerFlag(DEBUG_WEB_ACCESS_FLAG, {
		description: "Run web access debug command: search <query> or fetch <url>",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		const debugCommand = pi.getFlag(DEBUG_WEB_ACCESS_FLAG);
		if (typeof debugCommand !== "string") return;
		try {
			await runDebug(debugCommand, ctx.signal);
		} catch (error) {
			process.stderr.write(`${asErrorMessage(error)}\n`);
			process.exit(1);
		}
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web using Exa. Requires EXA_API_KEY. No fallback providers.",
		promptSnippet: "Search the web with Exa",
		promptGuidelines: [
			"Use web_search for current web results when local files are insufficient.",
			"Use fetch_content with result URLs when full page content is needed.",
		],
		parameters: WebSearchParams,
		async execute(_toolCallId, params, signal) {
			try {
				const results = await searchExa(params, signal);
				return ok(formatSearchResults(results), { results });
			} catch (error) {
				return fail(asErrorMessage(error), { query: params.query });
			}
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("accent", args.query ?? "..."),
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			if (options.isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
			const text = getTextContent(result);
			const isError = text.startsWith("Error: ");
			return new Text(theme.fg(isError ? "warning" : "toolOutput", text), 0, 0);
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description: "Fetch a URL and return readable markdown/text. HTTP(S) only; no GitHub, PDF, or video special handling.",
		promptSnippet: "Fetch readable content from a web URL",
		parameters: FetchContentParams,
		async execute(_toolCallId, params, signal) {
			try {
				const result = await fetchContent(params.url, signal);
				return ok(`# ${result.title}\n\n${result.content}`, result);
			} catch (error) {
				return fail(asErrorMessage(error), { url: params.url });
			}
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("fetch_content ")) + theme.fg("accent", args.url ?? "..."),
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			if (options.isPartial) return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			const text = getTextContent(result);
			const lines = text.split("\n");
			const shown = options.expanded ? lines : lines.slice(0, 8);
			const isError = text.startsWith("Error: ");
			let rendered = shown.map((line) => theme.fg(isError ? "warning" : "toolOutput", line)).join("\n");
			if (!options.expanded && lines.length > shown.length) {
				rendered += `\n${theme.fg("muted", `... ${lines.length - shown.length} more lines (Ctrl+o to expand)`)}`;
			}
			return new Text(rendered, 0, 0);
		},
	});
}
