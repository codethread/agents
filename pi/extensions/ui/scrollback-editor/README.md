# `scrollback-editor`

Replace Pi's `Ctrl+G` external-editor handoff with a Neovim buffer containing the current rendered-session history and a prompt editing area.

The extension reconstructs the transcript from Pi's compaction-aware resolved session context—the same source Pi uses when rebuilding scrollback—rather than exporting the raw session tree. User and assistant text is included, hidden thinking is represented only by a collapsed placeholder, images are omitted, and each tool result is condensed to its final five lines. Extension-specific rendered cards that have no message text are not reproduced.

Bash tool calls and direct shell commands are emitted as fenced `bash` blocks. Neovim runs with the user's normal configuration, plugins, and theme.

## Neovim configuration

The extension identifies its temporary buffer with `PI_SCROLLBACK_FILE` and records an intentional save through `PI_SCROLLBACK_SAVE_MARKER`. Add this to your Neovim configuration:

```lua
local scrollback_file = vim.env.PI_SCROLLBACK_FILE
local save_marker = vim.env.PI_SCROLLBACK_SAVE_MARKER

if scrollback_file and save_marker then
	local function is_scrollback_buffer(buffer)
		local realpath = vim.uv.fs_realpath(vim.api.nvim_buf_get_name(buffer))
		return realpath == vim.uv.fs_realpath(scrollback_file)
	end

	vim.api.nvim_create_autocmd('BufReadPost', {
		callback = function(event)
			if not is_scrollback_buffer(event.buf) then return end
			local marker_line = vim.fn.search('<!-- pi:prompt:start -->', 'nw')
			if marker_line > 0 then
				vim.api.nvim_win_set_cursor(0, { marker_line + 1, 0 })
				vim.cmd.startinsert()
			end
		end,
	})

	vim.api.nvim_create_autocmd('BufWritePost', {
		callback = function(event)
			if is_scrollback_buffer(event.buf) then vim.fn.writefile({ 'saved' }, save_marker) end
		end,
	})
end
```

The filename has a `.md` suffix, so a standard Neovim setup will detect Markdown and enable its usual syntax support. The cursor/start-insert autocmd is optional; the save-marker autocmd is required for saved prompt text to return to Pi.

## Usage

Press `Ctrl+G` in Pi's main prompt editor. The extension pauses Pi's TUI and opens:

```text
PI_SCROLLBACK_FILE=<temporary-session.md> \
PI_SCROLLBACK_SAVE_MARKER=<temporary-saved-marker> \
nvim <temporary-session.md>
```

The buffer's bottom section looks like this:

```markdown
<!-- pi:prompt:start -->

The current Pi prompt is here.

<!-- pi:prompt:end -->
```

- Edit only the text between the markers, then use `:wq` to put that text back into Pi's prompt.
- Use `:q!` (or `ZQ`) to return without changing the prompt.
- Saving once and later quitting discards later unsaved changes but still applies the last saved prompt.

## Debug flag

`--debug-scrollback-editor` prints the Neovim command, prompt markers, and tool preview limit, then exits.
