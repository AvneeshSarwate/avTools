Below is a handoff-quality implementation plan for a **Rust (midir) ↔ Deno** bridge that delivers **coalesced state updates** but exposes an ergonomic JS API like:

```ts
input.onCC(({ channel, ctrlNum, ctrlVal }) => {});
input.onPitchBend(({ channel, bend }) => {});
input.onNoteOn(({ channel, noteNum, velocity }) => {});
input.onNoteOff(({ channel, noteNum, velocity }) => {});
input.onNote(({ channel, noteNum, on, velocity }) => {});
```

…and a robust **MPE layer** for “note start / note update / note end” → OSC.

---

## 0) Key constraints & invariants

**Hard requirements**

* No Deno-side polling/worker needed for correctness; deliver events via event-loop callbacks.
* Input is **coalesced** for continuous data (CC / PB / pressure), but **note edges are preserved** (MPE correctness).
* Runs on Raspberry Pi: avoid per-message allocations, bound worst-case work, and provide overload telemetry.
* Deno receives callbacks using `Deno.UnsafeCallback.threadSafe()` (wakes event loop from foreign threads). ([Deno][1])

**Facts to anchor behavior**

* `midir` calls your input callback for each incoming message, giving `(timestamp_us, bytes)`; timestamp is microseconds since an unspecified stable reference for the connection lifetime. ([Docs.rs][2])
* `midir` ports have stable opaque IDs: `MidiInputPort::id()` returns a “unique stable identifier” string; `MidiInput::find_port_by_id` exists (same for output).
* Deno pointer data must be copied immediately; `Deno.UnsafePointerView.copyInto()` does this. ([Deno][3])
* Thread-safe callbacks keep Deno alive unless `unref()` is called; but `unref()` still allows waking the event loop. ([Deno][4])

---

## 1) JS/TS public API (what users will write)

### 1.1 MidiAccess / devices

```ts
const midi = MidiAccess.open({ libPath: "./target/release/libmidi_bridge.so" });

const inputs  = midi.listInputs();   // [{ id: string, name: string }]
const outputs = midi.listOutputs();

const input  = midi.openInput(inputs[0].id, { rateHz: 250 });
const output = midi.openOutput(outputs[0].id);
```

Port IDs are strings coming from `midir`’s `port.id()` (opaque).

### 1.2 Input ergonomics (your requested API)

All register methods return `unsubscribe()`.

```ts
input.onCC(({ channel, ctrlNum, ctrlVal, tsUs }) => {});
input.onPitchBend(({ channel, bend, tsUs }) => {});          // bend: -8192..8191
input.onChannelPressure(({ channel, pressure, tsUs }) => {});
input.onPolyPressure(({ channel, noteNum, pressure, tsUs }) => {});
input.onProgramChange(({ channel, program, tsUs }) => {});

input.onNoteOn(({ channel, noteNum, velocity, tsUs }) => {});
input.onNoteOff(({ channel, noteNum, velocity, tsUs }) => {});
input.onNote(({ channel, noteNum, on, velocity, tsUs }) => {});
```

Optional: one “batch per tick” hook (good for OSC output):

```ts
input.onTick((tick) => {
  // tick.tsUs, tick.ccChanges[], tick.pbChanges[], tick.noteEvents[], tick.dropped...
});
```

### 1.3 Output (reflects midir)

```ts
output.send(Uint8Array.of(0xB0, 74, 100)); // raw
output.cc(0, 74, 100);
output.pitchBend(0, 1234);
output.noteOn(0, 60, 100);
output.noteOff(0, 60, 64);
```

### 1.4 MPE helper API (for visuals → OSC)

```ts
const mpe = input.asMPE({
  zone: "lower",             // or "upper"
  masterChannel: 0,          // usually 0 for lower, 15 for upper
  memberChannels: [1, 15],   // inclusive range: 1..15 for lower
  timbreCC: 74,              // default CC74
});

mpe.onNoteStart(({ channel, noteNum, velocity, pressure, timbre, bend }) => {});
mpe.onNoteUpdate(({ channel, noteNum, pressure, timbre, bend }) => {}); // coalesced per tick
mpe.onNoteEnd(({ channel, noteNum, velocity }) => {});
```

---

## 2) Coalescing semantics (including MPE-correct note behavior)

### 2.1 Continuous messages (coalesced)

Coalesce per key “latest wins” between dispatch ticks:

* CC: key = `(channel, cc)` → store last `value`
* Pitch bend: key = `channel` → store last `bend`
* Channel pressure: key = `channel` → store last `pressure`
* Poly pressure: key = `(channel, note)` → store last `pressure` (optional, but useful)
* Program change: key = `channel`

Emission rule:

* At each dispatch tick (e.g., 250 Hz), emit **only keys that changed** since last dispatch.
* Each emitted change includes the **timestamp of the last raw MIDI message** that set it (from midir). ([Docs.rs][2])

### 2.2 Notes (NOT coalesced by default)

**Notes are edge events.** Preserve every NoteOn/NoteOff edge in order.

Normalize:

* `NoteOn velocity=0` is treated as `NoteOff` (normalize in parser).

Why: MPE correctness depends on reliable note edges.

### 2.3 MPE subtleties (the “correct” parts)

MPE uses **one channel per active note** (member channels). Your bridge should assume that for MPE mode, but still remain safe if violated.

Maintain in TS (or Rust, either works) for each channel:

* `activeNotes[channel]` as a small set (usually size 0 or 1 in MPE)
* For MPE helper: “voice identity” is `channel`, and `noteNum` is whatever is active on that channel.

**How MPE helper coalesces:**

* `onNoteStart`: fired when NoteOn arrives on a member channel. Payload includes:

  * note/velocity
  * **current coalesced continuous state** for that channel (bend/pressure/timbre) at end of tick
* `onNoteUpdate`: at most once per tick per active voice, with any changed dims.
* `onNoteEnd`: fired on NoteOff; clears voice.

If a channel somehow has multiple active notes (non-MPE behavior), MPE helper can:

* either pick “most recent NoteOn” as the voice note and emit a warning counter,
* or disable note association for that channel until it returns to 0/1 active note.

---

## 3) Rust crate design (midir + coalescer + dispatcher)

### 3.1 Recommended module layout

* `src/lib.rs` – exports C ABI; global handle tables
* `src/ffi.rs` – C ABI types, packet encoder, string/buffer helpers
* `src/ports.rs` – list ports, find port by id, name lookup
* `src/input/mod.rs`

  * `input/reader.rs` – midir connection + raw callback
  * `input/parser.rs` – MIDI byte parser (status, running status optional)
  * `input/state.rs` – coalesced state store (CC arrays, PB, pressure, program, etc.)
  * `input/dispatch.rs` – tick thread, packet build, call Deno callback
  * `input/queues.rs` – bounded queues + drop counters
* `src/output.rs` – midir output connection + send helpers
* `src/util.rs` – bitsets, smallvec, timing (your fast sleep hook)

### 3.2 Threading model (robust on Pi)

**Do NOT call Deno from midir callback.** Keep it tiny.

1. **midir callback**: receives `(ts_us, bytes)`; copy bytes into a bounded queue and return ASAP. ([Docs.rs][2])
2. **coalescer thread**: drains raw queue, parses messages, updates coalesced state + note edge queue
3. **dispatcher thread**: runs at `rateHz` (100–500 Hz), builds one packet of “changes since last tick” + note edges, then calls the Deno callback pointer

Overload behavior:

* raw queue full → drop newest (or oldest), increment `dropped_raw`
* note edge queue full → drop oldest edge (safer to keep recent state), increment `dropped_note`

Both counters are included in the outgoing packet so the JS side can log/telemetry.

### 3.3 Parsing + state data structures

Use fixed arrays for speed:

* `cc[16][128] : u8`
* `cc_dirty[16] : bitset128` (2×u64)
* `pitch_bend[16] : i16` + `pb_dirty[16] : bool`
* `ch_pressure[16] : u8` + dirty
* `program[16] : u8` + dirty
* `poly_pressure[16][128] : u8` + dirty bitset (optional)
* notes:

  * note edges buffered as `VecDeque<NoteEdge>` (bounded)
  * optionally maintain `notes_down[16][128] : bool` for validation / note state mode

Optional “nice for MPE”:

* Track pitch bend range via RPN 0,0 (CC101/100 + CC6/38). (Not required for correctness; useful for mapping to normalized bend.)

---

## 4) FFI surface (C ABI) between Deno and Rust

### 4.1 Library calls (Rust exports)

Use “fill buffer” pattern to avoid cross-allocator free.

**Port listing**

* `midi_list_inputs(out_ptr: *mut u8, out_cap: u32) -> u32`
* `midi_list_outputs(out_ptr: *mut u8, out_cap: u32) -> u32`

Returns required size if `out_ptr` null / cap 0. Writes UTF-8 JSON like:

```json
[{ "id": "<opaque>", "name": "LinnStrument MIDI" }, ...]
```

(IDs come from `port.id()`, names from `port_name`.)

**Input open/close**

* `midi_open_input(port_id_ptr: *const u8, port_id_len: u32, rate_hz: u32, flags: u32, cb: extern "C" fn(*const u8, u32)) -> u32 handle`
* `midi_close_input(handle: u32)`

**Output open/close**

* `midi_open_output(port_id_ptr: *const u8, port_id_len: u32) -> u32 handle`
* `midi_close_output(handle: u32)`

**Send**

* `midi_send(handle: u32, bytes_ptr: *const u8, len: u32) -> i32`
* optional helpers: `midi_send_cc`, `midi_send_pb`, etc.

### 4.2 Callback signature & Deno requirements

Callback receives a pointer+length to a packet buffer:

`cb(packet_ptr, packet_len)`

On Deno side:

* register with `Deno.UnsafeCallback.threadSafe()` so foreign-thread calls wake the event loop ([Deno][1])
* immediately copy `packet_len` bytes using `Deno.UnsafePointerView.copyInto()` ([Deno][3])
* never use callback after `.close()` (Deno docs warn this can crash) ([Deno][5])

---

## 5) Packet format (binary, versioned, robust)

Use a single record stream (easy ordering, easy parsing, minimal JS overhead).

### 5.1 Header (fixed)

* `u32 magic` = `0x4D494452` (“MIDR”)
* `u16 version` = 1
* `u16 flags`
* `u64 dispatch_ts_us`
* `u32 dropped_raw`
* `u32 dropped_note`
* `u32 record_count`
* `u32 reserved`

### 5.2 RecordV1 (16 bytes each)

* `u64 ts_us` (timestamp of the last update for this record)
* `u8 kind`
* `u8 channel` (0–15)
* `u8 a`
* `u8 b`
* `i16 v16`
* `u16 extra`

Kinds:

* `1 CC`:        `a=cc`, `b=val`
* `2 PB`:        `v16=bend (-8192..8191)`
* `3 CH_PRESS`:  `b=pressure`
* `4 POLY_PRESS`:`a=note`, `b=pressure`
* `5 PROG`:      `b=program`
* `6 NOTE`:      `a=note`, `b=velocity`, `extra bit0 = 1(on) / 0(off)`

**Ordering:**

* Dispatcher builds list of all records (note edges + coalesced continuous changes), sorts by `ts_us` (stable or unstable). This gives MPE-correct “prep state before note” behavior when devices send expression before note-on.

Config knob:

* `flags` can include `UNSORTED` if record_count is huge and you choose to skip sorting under overload (optional). If you implement this, TS should still function, just with weaker ordering guarantees.

---

## 6) TypeScript wrapper internals (well organized)

### 6.1 File layout (TS)

* `mod.ts` – public exports
* `ffi.ts` – `Deno.dlopen` symbol definitions + helper to read JSON buffers
* `decode.ts` – packet decode (DataView) → iterator of records
* `events.ts` – typed listener registries
* `midi_access.ts` – `MidiAccess` implementation
* `midi_input.ts` – `MidiInput` + `onCC/onNote...`
* `midi_output.ts` – `MidiOutput` + send helpers
* `mpe.ts` – `asMPE()` helper layer (built on top of MidiInput)

### 6.2 Deno callback implementation pattern

* Create `UnsafeCallback.threadSafe(def, fn)` ([Deno][1])
* Optional: if you don’t want it to keep the process alive, call `cb.unref()` right after creation (still wakes event loop). ([Deno][4])
* In callback:

  1. allocate `Uint8Array(len)`
  2. `copyInto(ptr, bytes)` ([Deno][3])
  3. decode and dispatch
  4. catch exceptions so they don’t propagate out of callback

### 6.3 Listener dispatch strategy (performance-friendly)

* Keep one `Set<fn>` per event type:

  * `ccListeners`, `pbListeners`, `noteOnListeners`, etc.
* Decode record stream once; for each record:

  * if no listeners for that kind, skip object allocation entirely
  * else create payload object and call listeners

Optional “batch per tick”:

* During callback, accumulate arrays per kind; after loop, call `tickListeners` once. Great for “map to OSC” pipelines.

---

## 7) MPE helper (correctness-oriented design)

The MPE layer is *pure TS* on top of the decoded stream:

### 7.1 Configuration

* Zone: `"lower"` or `"upper"`
* Master channel + member channel range
* Timbre CC (default 74)

### 7.2 Voice model

Per member channel maintain:

* `noteNum?: number`
* `velocity?: number`
* `bend: number`
* `pressure: number`
* `timbre: number`
* `dirtyDims` flags within current tick

### 7.3 MPE event emission rules

* When NOTE(on) on member channel:

  * set `voice.noteNum = note`, store velocity
  * mark “started this tick”
* When continuous records arrive on member channel:

  * update `voice.bend/pressure/timbre`
  * mark dirty
* When NOTE(off):

  * mark “ended this tick”; clear after flush

**Flush at end of each packet callback**:

* For any channel started this tick: fire `onNoteStart` with full current dims snapshot
* For any channel with dirty dims and active note: fire `onNoteUpdate` once (coalesced)
* For any channel ended this tick: fire `onNoteEnd`

This gives you a clean, frame-like stream ideal for OSC.

---

## 8) Build + install flow (one-time script, no prebuilds)

Deliver a `scripts/build.sh` (and `build.ps1` if you care about Windows) that:

* runs `cargo build --release`
* copies the `.so/.dylib/.dll` into a predictable path (e.g. `./native/`)
* prints the expected `libPath` for Deno

Raspberry Pi:

* standard `cargo build --release` on-device is acceptable
* keep dependencies small; avoid heavy allocators
* provide a “headless test” binary `cargo run -p midi_bridge_cli -- list` to verify midir sees ports

---

## 9) Testing plan (this is what makes it “get it right once”)

### 9.1 Rust unit tests

* Parser tests:

  * CC, PB, pressure, poly pressure, program, note on/off, note-on-vel0 normalization
  * optional running status cases
* Coalescer tests:

  * multiple CC updates within one tick → only last emitted
  * note edges preserved
  * drop counters increment under forced queue overflow

### 9.2 Rust integration tests

* “virtual ports” tests on Unix (midir supports virtual ports on Unix; optional but very useful).
* connect virtual output → input, send bursts, verify packets and ordering

### 9.3 Deno tests

* Decoder tests: feed known packet bytes, verify decoded records
* Listener tests: register handlers, ensure correct call counts and payload shapes
* MPE tests: simulate typical MPE streams (note on member channel + pressure/bend/cc74), ensure start/update/end behavior

### 9.4 Performance / stress

* Stress generator:

  * send 5k msgs/sec into the coalescer for 10s
  * ensure no panics, bounded CPU, dropped counters behave
* Pi profiling:

  * measure max sustainable message rate before drops (log counters)

---

## 10) What to hand to the coding agent (task breakdown)

**Milestone A — Rust midir I/O**

* [ ] Implement `listInputs/listOutputs` using port `id()` + `port_name` + JSON serialization
* [ ] Implement `open_input(port_id)` using `find_port_by_id` + `connect` callback ([Docs.rs][2])
* [ ] Implement `open_output(port_id)` + `send(&[u8])`

**Milestone B — Coalescer + packet encoder**

* [ ] Bounded raw queue + note edge queue + drop counters
* [ ] Parse core channel messages; normalize note-off
* [ ] Coalesce continuous keys; preserve note edges
* [ ] Encode PacketV1 + RecordV1; stable sort by `ts_us`

**Milestone C — Deno FFI + TS wrapper**

* [ ] `ffi.ts`: dlopen symbols, port list buffer helper, open input/output
* [ ] `UnsafeCallback.threadSafe` callback that copies packet bytes via `copyInto` ([Deno][1])
* [ ] Decoder + listener registry + ergonomic `onCC/onNote...`

**Milestone D — MPE helper**

* [ ] `asMPE()` producing `noteStart/noteUpdate/noteEnd` (coalesced per tick)
* [ ] Tests for typical MPE patterns

**Milestone E — Docs + scripts**

* [ ] build script(s)
* [ ] usage examples (Deno script + notebook snippet)
* [ ] troubleshooting notes (permissions: `--allow-ffi`, library path, etc.)

---

If you want, I can also provide the **exact TS type definitions** for every callback payload (CC/PB/pressure/note) + a “reference decoder” implementation for PacketV1/RecordV1 so your agent can start from something copy/pasteable and consistent across Rust and TS.

[1]: https://docs.deno.com/api/deno/~/Deno.UnsafeCallback.threadSafe?utm_source=chatgpt.com "Deno documentation - UnsafeCallback.threadSafe"
[2]: https://docs.rs/midir/latest/midir/struct.MidiInput.html?utm_source=chatgpt.com "MidiInput in midir - Rust"
[3]: https://docs.deno.com/api/deno/~/Deno.UnsafePointerView.copyInto?utm_source=chatgpt.com "Deno documentation - UnsafePointerView.copyInto"
[4]: https://docs.deno.com/api/deno/~/Deno.UnsafeCallback.prototype.unref?utm_source=chatgpt.com "Deno documentation - UnsafeCallback.prototype.unref"
[5]: https://docs.deno.com/api/deno/~/Deno.UnsafeCallback?utm_source=chatgpt.com "Deno.UnsafeCallback - Deno documentation"
