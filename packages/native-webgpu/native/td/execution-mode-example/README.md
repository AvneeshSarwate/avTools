# Execution modes example

Open **ExecutionModes.toe** directly in TouchDesigner on Apple Silicon macOS.
It contains its own script and resolves the repository's current prebuilt plugin.
No Node, compiler, terminal watcher, or project generation step is required.
`ExecutionModes.tox` contains just the component for another project.

- `channels1` has **Wait for Current Result** on. `channels2`–`channels4` have it off.
- Change `controls/value`; outputs are twice it and its negative.
- Set `controls/work_ms` to 10 or 50 to add intentional slow JavaScript. This is
  demonstration code, not a recommended animation technique.
- Toggle the mode while running: cook counts and independent timer ticks survive.
- `status1`–`status4` report cook cost, worker cost, output/input age, coalescing,
  and repeated-publication percentage. An older result is expected under overload.
- Set Event Name to `1`, Send Pulse, then `2`, Send Pulse: the pulses channel
  appends those digits. Changing Event Name later does not rename queued events.
- Pause TD playback and resume: realtime ticks advance on the worker; no extra
  frame-wait callbacks are synthesized during the pause.

The script is embedded in `sketch`; `channels.js` is the source used to generate
it. Both execution modes use exactly the same API. The project is saved with
zero artificial delay so it is safe to open and explore immediately.

See [the contract](../../../EXECUTION_MODES.md) and [measurements](VALIDATION.md).

## Reproduce

From TD Textport, execute a script with its `__file__` set, for example:

```python
path='/absolute/path/to/avTools/packages/native-webgpu/native/td/execution-mode-example/verify.py'
exec(compile(open(path).read(),path,'exec'),dict(globals(),__file__=path))
```

`create_fixture.py` creates a new isolated component in `/project1`.
`verify.py` checks pulse capture, state continuity, paused timers and a slow cook.
`benchmark.py` creates temporary helpers and runs 100 frames per scenario,
excluding the first 20. It covers one/four scalar/10k XY CHOPs at 0/10/50 ms in
both modes, plus four 1080p TOPs buffered/blocking/pretrigger. It takes about two
minutes and writes raw measurements under ignored `packages/native-webgpu/artifacts/`.
`verify_top.py` uses those helpers to verify a buffered-to-blocking TOP switch,
captured pulse names and pretrigger override. `restore_example.py` deactivates the
benchmark and restores the interactive example, retaining its helper operators. It does not delete
operators outside the example component.

TD 2025.31550 crashed during immediate deletion of benchmark helper DATs after a
completed test. The scripts now reuse/retain those helpers to avoid queued UI
callbacks referencing deleted DATs. The saved standalone example is generated
fresh and contains no benchmark helpers. See the validation notes.
