const EMOTE_FILES = [
	"idle/idle.png",
	"idle/idle_blink.png",
	"think/think.png",
	"think/think_hard.png",
	"talk/talk_close.png",
	"talk/talk_small.png",
	"talk/talk_mid.png",
	"talk/talk_wide.png",
	"read/read1.png",
	"read/read2.png",
	"write/write1.png",
	"write/write2.png",
	"tool/tool1.png",
	"tool/tool2.png",
	"failure/failure1.png",
	"failure/failure2.png",
	"hi/hi1.png",
	"hi/hi2.png",
	"compact/compact1.png",
] as const;

const DEFAULT_SUBJECT =
	"a squirrel-like creature with large expressive eyes, green skin, small ears, rounded cheeks, tiny fangs, cute mascot proportions";

function normalizeGuidance(guidance: string): string {
	return guidance.trim() || DEFAULT_SUBJECT;
}

export function buildEmoteGenPrompt(guidance: string): string {
	const subject = normalizeGuidance(guidance);
	const fileList = EMOTE_FILES.map((file) => `- tmp/emote-gen/default/${file}`).join("\n");

	return `Create image-generation prompt files for a Pi emote set.

Generate one temporary markdown prompt file for each emote frame listed below. Do not generate images. Each file should contain a self-contained prompt suitable for an image generation AI.

Subject/design guidance:
${subject}

Shared base style for every prompt:
Create a 128x128 pixel-art character portrait sprite in a retro handheld / Game Boy Color inspired style. Match the bundled Pi emote vibe: cute mascot bust portrait, front-facing or slight 3/4 front pose, large expressive anime/chibi eyes, rounded cheeks, simple compact silhouette, thick dark pixel outline, limited saturated retro palette, crisp readable pixel clusters, soft dithering, minimal detail, and a dark navy-charcoal tiled background. Keep the same character design, palette, outline weight, canvas scale, and background across all frames.

Global constraints for every prompt:
- square 128x128 canvas
- centered bust portrait, not full body
- transparent-free finished sprite with dark tiled background
- no text, no watermark, no logo, no UI frame
- clean pixel-art edges; no anti-aliasing or smooth vector look
- preserve consistent character identity across every frame

Negative prompt for every prompt:
high resolution illustration, smooth vector art, 3D render, realistic lighting, painterly, anti-aliased edges, complex background, full body, text, logo, watermark, blurry, overly detailed, inconsistent character design, different costume, different species

Frame-specific intent:
- idle/idle.png: calm neutral smile, relaxed eyes, default resting pose.
- idle/idle_blink.png: same as idle, eyes closed in a blink.
- think/think.png: thinking expression, one small paw touching chin, eyes looking slightly upward, small thought bubble made of white pixel circles.
- think/think_hard.png: intense thinking expression, furrowed brows or focused eyes, paw on chin, slightly stronger thought bubble.
- talk/talk_close.png: talking frame with tiny closed mouth, friendly eyes.
- talk/talk_small.png: talking frame with small open mouth.
- talk/talk_mid.png: talking frame with medium open mouth, lively expression.
- talk/talk_wide.png: talking frame with wide open mouth, cheerful energy.
- read/read1.png: reading/observing expression, eyes angled down as if scanning text, attentive.
- read/read2.png: alternate reading/observing frame, slightly different eye position or blink.
- write/write1.png: writing/creating expression, focused eyes, one paw raised as if holding a tiny stylus or making a mark.
- write/write2.png: alternate writing/creating frame, same pose with a small motion change.
- tool/tool1.png: tool-use expression, alert and busy, tiny pixel spark or gear-like accent near one side.
- tool/tool2.png: alternate tool-use frame, similar busy pose with small motion change.
- failure/failure1.png: cute failure/error expression, worried eyes, small sweat drop or wobble mark.
- failure/failure2.png: alternate failure frame, more startled but still cute.
- hi/hi1.png: greeting expression, bright smile, one small paw waving.
- hi/hi2.png: alternate greeting frame, paw wave shifted.
- compact/compact1.png: sleepy/compressing/resting expression, simplified compact pose, calm eyes.

Files to create:
${fileList}

After writing the files, reply with only the created file paths and a short note that these are prompts, not generated images.`;
}
