# Self Terminate

Allow an agent to end its Pi process only with direct user authorization, including permission conditional on completing work:

> Do task X. When it is complete and merged, you may self-terminate.

The `self-terminate` tool takes no arguments. Permission must never be inferred from task completion, an idle session, or general cleanup instructions. The agent is responsible for satisfying any conditions before invoking it; the tool does not verify merges or task status. Send any final report before calling it.

## Shutdown

The tool calls Pi's native `ctx.shutdown()` and returns a terminating tool result, avoiding another model request when it is the only tool in the batch. Pi waits for the run and queued messages to settle, restores the terminal, runs extension shutdown hooks, and exits. The session transcript remains available to resume.

In print/JSON mode, Pi's shutdown request is a no-op; the terminating result ends the current run and Pi exits through its normal prompt-processing path. RPC mode uses Pi's deferred graceful shutdown.

## Rex cleanup

Rex is optional. When `REX_SESSION` and `REX_BLOCK` identify a terminal whose process tree contains this Pi process, the tool resolves that terminal's tab. It never uses the app's focused tab. Tabs containing other panes are left open.

For an eligible tab, a detached helper is armed before shutdown. Its IPC connection closes only when the Pi process exits, so Rex closure happens after Pi's shutdown hooks, not after a fixed delay. The helper rechecks the tab before closing it and refuses if another pane has appeared. It survives terminal teardown and does not keep Pi alive.

The tool reports why Rex cleanup was skipped, or provides a temporary cleanup log path. Detection failures do not prevent Pi shutdown. Failure to start the helper fails the tool before requesting shutdown; failures after Pi exits are written to the cleanup log. Rex's CLI and Node.js must be on `PATH`; the helper runs under Node even when Pi is a standalone executable. Cleanup does not start a missing Rex server.

## Dry run

Launch Pi with `--debug-self-terminate` to make tool invocations report the detected Rex target without shutting down Pi or scheduling Rex closure. The flag does not grant permission to invoke the tool.
