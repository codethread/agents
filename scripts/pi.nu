# To regenerate model/provider lists:
#   pi --list-models | detect columns

def model-completions [] {
	[
		"anthropic/claude-haiku-4-5"
		"anthropic/claude-opus-4-7"
		"anthropic/claude-sonnet-4-6"

		"deepseek/deepseek-v4-flash"
		"deepseek/deepseek-v4-pro"

		"github-copilot/claude-haiku-4.5"
		# "github-copilot/claude-opus-4.7" # need to pay the pro+ bucks
		"github-copilot/claude-sonnet-4.6"
		# "github-copilot/gemini-3-flash-preview"
		"github-copilot/gemini-3.1-pro-preview"

		# "openai/gpt-5.3-codex-spark" not yet available outside max sub
		"openai/gpt-5.4-nano"

		"openai-codex/gpt-5.3-codex-spark"
		"openai-codex/gpt-5.4"
		"openai-codex/gpt-5.4-mini"
	]
}

def provider-completions [] {
	["anthropic", "deepseek", "github-copilot", "openai", "openai-codex"]
}

def thinking-completions [] {
	["off", "minimal", "low", "medium", "high", "xhigh"]
}

def mode-completions [] {
	["text", "json", "rpc"]
}

def tools-completions [] {
	["read", "bash", "edit", "write", "grep", "find", "ls"]
}

def --wrapped pi [
	--model(-m): string@model-completions     # Model pattern or ID (supports "provider/id")
	--provider: string@provider-completions   # Provider name
	--api-key: string                         # API key
	--system-prompt: string                   # System prompt
	--append-system-prompt: string            # Append text or file to system prompt
	--mode: string@mode-completions           # Output mode: text (default), json, rpc
	--print(-p)                               # Non-interactive mode
	--continue(-c)                            # Continue previous session
	--resume(-r)                              # Select session to resume
	--session: path                           # Use specific session file
	--session-id: string                      # Use exact project session ID, creating it if missing
	--fork: path                              # Fork session file or partial UUID
	--session-dir: path                       # Directory for session storage
	--no-session                              # Don't save session (ephemeral)
	--name(-n): string                        # Set the session display name shown in /tree and selectors
	--models: string                          # Comma-separated model patterns for cycling
	--no-tools                                # Disable all built-in tools
	--tools: string@tools-completions         # Comma-separated tools to enable
	--thinking: string@thinking-completions   # Thinking level
	--extension(-e): path                     # Load an extension file
	--no-extensions                           # Disable extension discovery
	--skill: path                             # Load a skill file or directory
	--no-skills                               # Disable skills discovery
	--prompt-template: path                   # Load a prompt template file or directory
	--no-prompt-templates                     # Disable prompt template discovery
	--theme: path                             # Load a theme file or directory
	--no-themes                               # Disable theme discovery
	--export: path                            # Export session to HTML and exit
	--list-models                             # List available models
	--verbose                                 # Force verbose startup
	--offline                                 # Disable startup network operations
	--help(-h)                                # Show help
	--version(-v)                             # Show version
	--long-cache                              # Set PI_CACHE_RETENTION=long for this invocation
	# Extension flags — update when new extensions add CLI flags (see pi/extensions/README.md)
	--agent: string                           # [EXT] Inherit discovered agent config by name (prompt/model/tools, unless overridden)
	--debug-prompt                            # [EXT] Print effective system prompt and exit (optional JSON override arg)
	--debug-tldr                              # [EXT] Print current session TL;DR and exit
	--debug-tldr-transcript                   # [EXT] Print transcript used by /tldr and exit
	--debug-tmux-title                        # [EXT] Print tmux window-title generation details
	--debug-emote                             # [EXT] Write emote widget debug logs
	--debug-interactive-shell: string         # [EXT] Run interactive_shell spawn/send/tail/kill directly (optional command)
	--debug-web-access: string                # [EXT] Run web access debug command: search <query> or fetch <url>
	--debug-pi-internals                      # [EXT] Print Pi internals discovery report and exit
	...args: string
] {
	mut pi_args = []

	if $model != null { $pi_args = ($pi_args | append ["--model" $model]) }
	if $provider != null { $pi_args = ($pi_args | append ["--provider" $provider]) }
	if $api_key != null { $pi_args = ($pi_args | append ["--api-key" $api_key]) }
	if $system_prompt != null { $pi_args = ($pi_args | append ["--system-prompt" $system_prompt]) }
	if $append_system_prompt != null { $pi_args = ($pi_args | append ["--append-system-prompt" $append_system_prompt]) }
	if $mode != null { $pi_args = ($pi_args | append ["--mode" $mode]) }
	if $print { $pi_args = ($pi_args | append "--print") }
	if $continue { $pi_args = ($pi_args | append "--continue") }
	if $resume { $pi_args = ($pi_args | append "--resume") }
	if $session != null { $pi_args = ($pi_args | append ["--session" $session]) }
	if $session_id != null { $pi_args = ($pi_args | append ["--session-id" $session_id]) }
	if $fork != null { $pi_args = ($pi_args | append ["--fork" $fork]) }
	if $session_dir != null { $pi_args = ($pi_args | append ["--session-dir" $session_dir]) }
	if $no_session { $pi_args = ($pi_args | append "--no-session") }
	if $name != null { $pi_args = ($pi_args | append ["--name" $name]) }
	if $models != null { $pi_args = ($pi_args | append ["--models" $models]) }
	if $no_tools { $pi_args = ($pi_args | append "--no-tools") }
	if $tools != null { $pi_args = ($pi_args | append ["--tools" $tools]) }
	if $thinking != null { $pi_args = ($pi_args | append ["--thinking" $thinking]) }
	if $extension != null { $pi_args = ($pi_args | append ["--extension" $extension]) }
	if $no_extensions { $pi_args = ($pi_args | append "--no-extensions") }
	if $skill != null { $pi_args = ($pi_args | append ["--skill" $skill]) }
	if $no_skills { $pi_args = ($pi_args | append "--no-skills") }
	if $prompt_template != null { $pi_args = ($pi_args | append ["--prompt-template" $prompt_template]) }
	if $no_prompt_templates { $pi_args = ($pi_args | append "--no-prompt-templates") }
	if $theme != null { $pi_args = ($pi_args | append ["--theme" $theme]) }
	if $no_themes { $pi_args = ($pi_args | append "--no-themes") }
	if $export != null { $pi_args = ($pi_args | append ["--export" $export]) }
	if $list_models { $pi_args = ($pi_args | append "--list-models") }
	if $verbose { $pi_args = ($pi_args | append "--verbose") }
	if $offline { $pi_args = ($pi_args | append "--offline") }
	if $help { $pi_args = ($pi_args | append "--help") }
	if $version { $pi_args = ($pi_args | append "--version") }
	if $agent != null { $pi_args = ($pi_args | append ["--agent" $agent]) }
	if $debug_prompt { $pi_args = ($pi_args | append "--debug-prompt") }
	if $debug_tldr { $pi_args = ($pi_args | append "--debug-tldr") }
	if $debug_tldr_transcript { $pi_args = ($pi_args | append "--debug-tldr-transcript") }
	if $debug_tmux_title { $pi_args = ($pi_args | append "--debug-tmux-title") }
	if $debug_emote { $pi_args = ($pi_args | append "--debug-emote") }
	if $debug_interactive_shell != null { $pi_args = ($pi_args | append ["--debug-interactive-shell" $debug_interactive_shell]) }
	if $debug_web_access != null { $pi_args = ($pi_args | append ["--debug-web-access" $debug_web_access]) }
	if $debug_pi_internals { $pi_args = ($pi_args | append "--debug-pi-internals") }

	$pi_args = ($pi_args | append $args)
	let final_pi_args = $pi_args

	if $long_cache {
		with-env { PI_CACHE_RETENTION: long } { ^pi ...$final_pi_args }
	} else {
		^pi ...$final_pi_args
	}
}

extern "pi install" [
	source: string
	--local(-l)                       # Install project-locally
]

extern "pi remove" [
	source: string
	--local(-l)
]

extern "pi update" [
	source?: string
]

extern "pi list" []
extern "pi config" []
