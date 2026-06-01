import type { EmoteState, EmotesConfig } from "./types.js";
import type { TUI } from "@earendil-works/pi-tui";

/**
 * A rendered frame — either a Kitty image sequence or Kitty Unicode placeholder lines.
 */
export type RenderedFrame =
	| {
			kind: "image";
			sequence: string;
			rows: number;
			padMode?: "spaces" | "skip";
	  }
	| { kind: "placeholder"; lines: string[]; rows: number };

/**
 * Renderer interface — abstracts how emote frames are loaded, stored, and displayed.
 *
 * Implementations use Kitty image protocols directly or through tmux passthrough.
 */
export interface Renderer {
	/** Set the TUI reference for requesting re-renders. */
	setTui(tui: TUI | null): void;

	/** Load frames for an emote set. */
	loadFrames(emoteSetDir: string, extDir: string): void;

	/** Get the current rendered frame (for the widget to read). */
	getRenderedFrame(): RenderedFrame | null;

	/** Set desired avatar width in terminal columns. */
	setSize(size: number): void;

	/** Show a specific named frame for a state. Returns false if not found. */
	showFrame(state: EmoteState, name: string, force?: boolean): boolean;

	/** Show a random frame for a state. Returns false if no frames. */
	showRandomFrame(state: EmoteState, force?: boolean): boolean;

	/** Show a weighted-random talk frame using emotes config. */
	showTalkFrame(emotesConfig: EmotesConfig): boolean;

	/** Show the talk close/rest frame. */
	showTalkCloseFrame(): boolean;

	/** Show a cycling frame for a state (read/write/tool). */
	showCycleFrame(state: EmoteState, index: number): boolean;

	/** Get number of cycle frames for a state. */
	getCycleFrameCount(state: EmoteState): number;

	/** Clean up resources (delete images, etc). */
	dispose(): void;

	/** Reset cached state so next show is forced. */
	resetCache(): void;
}
