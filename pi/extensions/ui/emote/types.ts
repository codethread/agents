export type EmoteState =
	| "hi"
	| "idle"
	| "think"
	| "talk"
	| "read"
	| "write"
	| "tool"
	| "failure"
	| "compact";

export type SizeConfig = number | Record<string, number | null>;

export interface Config {
	enabled: boolean;
	debug: boolean;
	size: SizeConfig;
	readingSpeed: number;
	hideBelow: number;
	holdDuration: { hi: number; failure: number };
	blinkInterval: [number, number];
	talkTickMs: number;
	cycleMs: number;
	textEllipsis: string;
	emotes: EmoteMapping[];
	terminals: TerminalMapping[];
}

export interface EmoteMapping {
	model: string;
	"emote-set": string;
}

export interface TerminalMapping {
	match: string;
	render: "kitty" | "kitty-unicode";
}

export interface ResolvedRenderer {
	protocol: "kitty" | "kitty-unicode" | "none";
	multiplexer: "tmux" | null;
	warning: string | null;
	warningLevel: "warning" | "info";
}

export interface EmotesConfig {
	idle?: { default?: string; blink?: string };
	think?: { default?: string; hard?: string };
	talk?: { weights?: Record<string, number> };
}

export interface FrameSet {
	files: string[];
	base64Cache: Map<string, string>;
}
