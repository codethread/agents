import { describe, expect, it } from "vitest";
import { buildEmoteGenPrompt } from "./emote-gen-prompt.js";

describe("buildEmoteGenPrompt", () => {
	it("builds a complete prompt set from custom guidance", () => {
		const prompt = buildEmoteGenPrompt("a pikachu-like creature with large eyes and green skin");

		expect(prompt).toContain("a pikachu-like creature with large eyes and green skin");
		expect(prompt).toContain("retro handheld / Game Boy Color inspired style");
		expect(prompt).toContain("tmp/emote-gen/default/idle/idle.png");
		expect(prompt).toContain("tmp/emote-gen/default/talk/talk_wide.png");
		expect(prompt).toContain("tmp/emote-gen/default/compact/compact1.png");
		expect(prompt).toContain("After writing the files, reply with only the created file paths");
	});

	it("uses the default mascot subject when guidance is empty", () => {
		const prompt = buildEmoteGenPrompt("   ");

		expect(prompt).toContain("a squirrel-like creature with large expressive eyes");
	});
});
