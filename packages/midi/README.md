# `@avtools/midi`

One MIDI-output API with browser and Deno/native backends.

The browser backend wraps the repository's existing `@midival/core` (MIDIVal)
dependency. The native backend wraps the existing Rust `midir` bridge in
`apps/deno-notebooks/midi`.

```ts
// Automatic: Web MIDI when navigator.requestMIDIAccess exists, native otherwise.
import { openMidiAccess } from "@avtools/midi";

// Deterministic alternatives with the exact same returned API:
import { openMidiAccess } from "@avtools/midi/browser";
import { openMidiAccess } from "@avtools/midi/native";

const midi = await openMidiAccess();
const ports = midi.listOutputs();
const output = await midi.openOutput(ports[0].id);

// Channels are zero-based on every backend. Pitch bend is -8192..8191.
output.noteOn(0, 60, 100);
output.cc(0, 74, 96);
output.pitchBend(0, 4096);
output.noteOff(0, 60, 64);

output.close();
midi.close();
```

`openMidiAccess` and `openOutput` are asynchronous on every backend because Web
MIDI permission and port opening are asynchronous. In a browser, call them from
a secure context and preferably in response to an explicit user gesture. Deno
callers need the same FFI/read permissions as the existing native MIDI module.

The automatic entry is convenient for source shared directly between Deno and a
browser. Browser applications with strict bundling rules can select
`@avtools/midi/browser` explicitly; doing so makes the native dependency graph
unreachable to the bundler.

Browser access is process-global inside MIDIVal, so `midi.close()` closes this
wrapper's output objects but cannot revoke MIDIVal's underlying `MIDIAccess`.

## Tests

Run unit/type tests from the repository root:

```sh
deno task --config packages/midi/deno.json test
```

On macOS, the native IAC loopback test accepts an optional bus name:

```sh
deno run --unstable-ffi --allow-ffi --allow-read --allow-env \
  packages/midi/tests/iac_loopback_native.ts "IAC Driver Bus 1"
```

For the browser loopback, start the native receiver:

```sh
deno run --unstable-ffi --allow-ffi --allow-read --allow-env \
  packages/midi/tests/iac_browser_receiver.ts "IAC Driver Bus 1"
```

Then serve `tests/browser_iac.html` through Vite and click its test button in
Chrome. The receiver verifies the exact note-on/note-off data sent by the
automatic browser backend.
