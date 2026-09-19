# notify

Registers `/notify [title message]`. It requires `cc-notify` to be installed, configured, and available on `PATH`; run `cc-notify --help` to verify the local installation.

The command privately arms a push notification for the next `agent_settled` event. It does not send a prompt or any other model-visible message, so it can be run while the agent is active without interfering with steering.

Without arguments, the notification title identifies the current Git project and branch:

```text
agent-ready agents(main)
```

Optional command text replaces everything after `agent-ready`:

```text
/notify working on notifications
```

This produces a notification like:

```text
agent-ready working on notifications

Here is the beginning of the agent's reply...
```

The notification body contains up to the first 500 characters of the final assistant response. The extension sends it to `cc-notify` over stdin and uses `--after 0ms` to bypass `cc-notify`'s configured default delay.

The request is one-shot: it is cleared before delivery and will not fire on later settlements unless `/notify` is run again. Running `/notify` again while armed replaces the pending title.

Use `--debug-notify` to print the extension's command and delivery configuration without sending a notification.
