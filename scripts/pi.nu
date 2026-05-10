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

extern "pi" [
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
	--fork: path                              # Fork session file or partial UUID
	--session-dir: path                       # Directory for session storage
	--no-session                              # Don't save session (ephemeral)
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
	# Extension flags — update when new extensions add CLI flags (see pi-extensions/README.md)
	--agent: string                           # [EXT] Inherit discovered agent config by name (prompt/model/tools, unless overridden)
	--debug-prompt: string                    # [EXT] Print effective system prompt and exit (optional JSON override arg)
	--debug-tldr                              # [EXT] Print current session TL;DR and exit
	--debug-tldr-transcript                   # [EXT] Print transcript used by /tldr and exit
	--debug-tmux-title                        # [EXT] Print tmux window-title generation details
	--debug-interactive-shell: string         # [EXT] Run interactive_shell spawn/send/tail/kill directly (optional command)
	--name: string                           # [EXT] Set the session display name shown in /tree and selectors
	--debug-session-name                     # [EXT] Print resolved --name session display name and exit
	...args: string
]

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
