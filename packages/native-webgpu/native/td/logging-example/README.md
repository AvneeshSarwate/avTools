# Open Logging.toe

Open **Logging.toe** in this directory. It resolves the checked-in macOS plugins
from the enclosing avTools repository. No Node process, compiler, or watcher is
needed to run this example. The matching **Logging.tox** can be dropped into
`/project1` of another avTools project; run its `startup` DAT's `onStart()` once
(or set the two plugin paths yourself).

- `sketch` draws an animated circle and logs TOP setup/frame/timer messages.
- `channels` outputs independent timer ticks and accepted frame counts.
- `*_source` Text DATs contain editable plain JavaScript.
- `*_logs` and `*_observer` are passive Info DATs showing the same operator history.

Select an operator's **Diagnostics** page. Log Level is Debug in this example,
so timer messages are visible; the plugin's normal default is Info. Use
**Refresh Logs (No Script)** while paused or idle. A passive Info DAT alone cannot
invalidate TD's source metadata cache. The refresh button holds outputs and does
not execute JavaScript. **Clear Logs** preserves running state and sequence
numbers. **Reset/Reload** creates a new generation and retains history.

On the Script/Sketch page set Event Name to `Trigger` and press Send Pulse.
`ErrorMessage` demonstrates `console.error` without stopping execution. `Throw`
demonstrates an actual runtime error; Reset recovers it.

There is no Console mirroring. Read [the logging contract](../../../LOGGING.md)
for formatting, bounds, diagnostics, and refresh behavior.

To regenerate: execute `create_fixture.py` in TD with `__file__` set to its full
path, starting with no `/project1/logging_example`; it saves Logging.tox. Then run
`python3 packages/native-webgpu/native/td/logging-example/build_projects.py` from
the repository. This uses TD's serialization tools to remove absolute plugin
paths and create the standalone Logging.toe. No user project is overwritten.
