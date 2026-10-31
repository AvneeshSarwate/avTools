# Native MIDI in TouchDesigner

MIDI device input/output is built into the macOS TOP and CHOP. No browser MIDI,
Node, Deno, npm install, or separately installed MIDI library is needed. See
the generated template’s `sketches/midi/picture.ts` and `sketches/midi/channels.ts` (Output Channels:
`value note velocity`), and `sketches/midi/explicit.ts`.

Declare a device selector as literal entrypoint metadata:

```ts
export const parameters = {
  Controller: { type: 'midiInput', label: 'MIDI Controller', page: 'MIDI' },
} as const;
```

Inside setup, use `host.midi.bindInput('Controller')`. Type the host as
`ChopHost<typeof parameters>` or `Setup<typeof parameters>` to restrict binding
names to MIDI parameters. The dropdown defaults to **None**, displays names, and
stores device IDs. It preserves unavailable selections without choosing another
device. Choices refresh when the menu is built (cached up to one second).

The returned logical handle retains listeners when the selection changes. Each
operator has independent subscriptions, so several TOPs/CHOPs can use the same
controller. Changing selection closes the old connection and discards its pending
messages. MIDI selection updates use a separate worker control path; ordinary
`host.params` still represents the latest accepted cook snapshot.

```ts
const controller = host.midi.bindInput('Controller', {
  rateHz: 250,
  rawCC: true,
});

const unsubscribe = controller.on('cc', ({ controller, value, timeMs }) => {
  // Read current state, update state, or start a TimeContext task here.
});

controller.on('noteOn', ({ note, velocity }) => { /* ... */ });
controller.onStatus(() => {
  console.log(controller.port, controller.connected, controller.error);
});
```

All callbacks run on this script's worker, independently of TD cooking, and have
normal TimeContext lifetime ownership. They do not interrupt executing JS.
Drawing/output consumption occurs on later cooks. Exceptions use the normal
script error path. Do not do expensive per-message work unnecessarily.

### MIDI methods and types

`host.midi` provides:

- `listInputs()` / `listOutputs()`: arrays of `{id, name, manufacturer}`;
  manufacturer is currently `null`. IDs are opaque strings, not list indexes or
  portable device names. Re-select on another computer when necessary.
- `bindInput(parameterName, options?)`: managed selector binding; requires a
  declared `midiInput` parameter. Can be used for several differently named inputs.
- `await openInput(deviceId, options?)`: explicit connection; rejects if opening
  fails. This has the same listener interface but no parameter binding.
- `await openOutput(deviceId)`: explicit MIDI output. `send(Uint8Array | number[])`,
  `noteOn(channel, note, velocity=100)`, `noteOff(channel, note, velocity=0)`,
  `cc(channel, controller, value)`, `pitchBend(channel, bend)`,
  `polyPressure(channel, note, pressure)`, `channelPressure(channel, pressure)`,
  `programChange(channel, program)`, and `close()`. Sends are immediate; native
  scheduled output is not exposed. Coordinate messages yourself if several
  scripts send to the same destination.
- `stats`: cumulative native-runtime counters `droppedMessages`, `batches`,
  `queuedBatches`, `inputs`, `outputs`. A full runtime restart resets them.

An input handle has `port` (or null), `connected`, `closed`, `error`,
`onMessage(callback)`, `on(type, callback)`, `onStatus(callback)`, `reconnect()`,
and `close()`. Listener registration returns an unsubscribe function. `connected`
means a native connection was opened; it is not a live cable-health guarantee.
Missing selections remain disconnected with `error`; **None** has no error.
`reconnect()` retries explicitly. Hardware unplug/replug is not automatically
reconnected. Handles close automatically on reload/reset/deletion; pending MIDI
is discarded, with no replay or state restoration. Other operators continue.

Input event types and fields (all include `channel` and `timeMs`):

| Type | Additional fields |
| --- | --- |
| `noteOn`, `noteOff` | `note`, `velocity` |
| `cc` | `controller`, `value` |
| `pitchBend` | `bend` |
| `polyPressure` | `note`, `pressure` |
| `channelPressure` | `pressure` |
| `programChange` | `program` |

Channels are 0–15; normal values are 0–127; pitch bend is -8192–8191. Note-on
velocity zero becomes note-off. `timeMs` retains the backend's source timestamp
in milliseconds: compare deltas within a connection; do not subtract it from
`performance.now()` or TD timeline time, or assume the epoch survives reconnect.

### Delivery and limits

`rateHz` is an integer 1–1000 (default 250: approximately 4 ms batching), and
`rawCC` is boolean (default true). Idle inputs do not poll. Batching reduces
worker wakeups; raw CC still invokes handlers for each message. With `rawCC:false`,
CC is latest-value-per-controller within a batch and unchanged values may be
suppressed. Use raw CC for relative encoders, RPN/NRPN and other stateful message
sequences. Pitch bend, pressure and program changes retain their existing
latest-value coalescing. Note transitions are individually queued.

Delivery is bounded: 32 open input/output connections per instance, native queues
of 4096 raw messages/notes/raw CC entries, and a worker queue of 128 batches / 1 MiB.
Overload drops messages and increments counters; it can lose note-offs. There is
no lossless guarantee during overload or reload. Output sends accept up to 64 KiB.
The current input supports MIDI 1.0 channel-voice messages, not SysEx, clock,
transport, song position or MIDI 2.0/UMP. OSC's MIDI argument type is unrelated
to opening native MIDI devices.

Implementation plan: [native MIDI](plans/td-native-midi-plan.md).
Validation: [native and TD tests](test/midi/README.md).

Open the checked-in [MIDI.toe example](native/td/midi-example/MIDI.toe); its
[README](native/td/midi-example/README.md) explains the four-instance network.
