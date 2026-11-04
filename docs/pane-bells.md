# Pane bell indicators

Attached terminal views show an amber **BELL** indicator in desktop and XR headers when a bell is received. It stays visible until the pane is selected or focused, including selecting an already active pane. It does not play a sound or send terminal input.

The viewer observes events while its pane stream is connected. It does not reconstruct old bell history for unopened panes. A pending indication survives pausing or reconnecting that view, but closing the view or reloading the application discards its local attention state.

The current mux stream preserves ordinary BEL in terminal output. Mux XR uses xterm's bell event so BEL-terminated OSC title and progress sequences do not produce false alerts. Explicit protocol Bell messages are also supported. Initial-screen replay and output from old connections do not raise new indicators, and focusing a pane acknowledges already queued output.

The protocol's separate Bell event is not currently forwarded by the mux mirror. That upstream enhancement is tracked separately; the parser path works with the current server.
