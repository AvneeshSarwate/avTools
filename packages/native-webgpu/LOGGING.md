# JavaScript console logs in TouchDesigner

Use `console.log`, `console.info`, `console.warn`, `console.error`, and
`console.debug` in TOPs, CHOPs, timers, or imported libraries. Messages stay with
that operator. No helper DAT or `host.log` API is required. `console.error` does
not throw or stop the script; actual exceptions still use the operator's error
path, and build diagnostics remain separate.

Open [Logging.toe](native/td/logging-example/Logging.toe) for a TOP, a CHOP, source
DATs, and two Info DAT observers per operator.

## Controls

On the source operator's **Diagnostics** page:

| Parameter | Default | Behavior |
| --- | --- | --- |
| Info DAT View (`Infoview`) | Diagnostics | Diagnostics or Logs; shared by all Info DATs targeting this operator. |
| Log Level (`Loglevel`) | Info | Minimum future severity: Debug, Info, Warning, Error, Off. `log` and `info` have Info severity. Existing history stays. |
| Clear Logs (`Clearlogs`) | Pulse | Clear history and counters, preserving sequence numbering and script state. Also refresh the metadata. |
| Refresh Logs (No Script) (`Refreshlogs`) | Pulse | Refresh TD's cached table without running JavaScript, submitting/collecting a frame, or processing queued script controls. |

Console/stderr mirroring is deliberately deferred. TOP/CHOP console capture does
no terminal I/O and creates no output thread or process. Standalone `Runtime`
and bridge callers without an attached log sink retain bounded formatting with
synchronous stderr output as their compatibility fallback.

Logs columns are `sequence | time_ms | generation | level | message`.
Sequence increases over the operator lifetime, including across Clear Logs.
Time is monotonic milliseconds since the operator's logger was created, not TD
timeline time. A generation starts with each fresh script activation, including
failed startup. `[runtime activation]` is an Info-level lifecycle message.
History survives Reload/Reset and automatic replacement, but not deletion or
closing the project. No history is serialized into `.toe`/`.tox` files.

Diagnostics retains all existing build/reload/transport keys and adds
`log_retained`, `log_evicted` (oldest history overwritten), `log_dropped` (new
message rejected by storage-lock contention), and `log_truncated` (message byte
argument/visited-value limit reached). There are no mirror counters because there
is no mirroring path.

## Paused and idle operators

Native capture continues while a timer runs independently of TD cooking.
**On TD 2025.31550, custom Info DAT data is cached on the source operator.**
Force-cooking a passive Info DAT alone, or creating a second observer, does not
refresh that cached table. Use **Refresh Logs (No Script)** to request a native
metadata-only cook, then refresh/read the Info DAT on the next TD UI update.
Clear Logs does the same metadata refresh automatically.

This increments TD's source `totalCooks` but leaves the runtime cook count and
script frame state unchanged. TOP output is held and CHOP output is copied from
the already-held output; neither operation consumes a new worker result.
Pending pulses, Reload/Reset, source changes, and build work wait for the next
normal cook. Normal running source cooks refresh the table as usual.

Set an Info DAT's **Passive** parameter on when observing logs without pulling
the sketch. An active Info DAT can cause normal source cooking under TD's usual
dependency rules. There is no automatic paused refresh loop. Multiple observers
read nondestructively; TD's callback table is one immutable bounded snapshot.
Changing view/level parameters can itself dirty an operator under TD's normal
parameter rules; Refresh Logs applies those controls without advancing JS.

See Derivative's [Info DAT reference](https://derivative.ca/UserGuide/Info_DAT)
for Passive mode; the source-cache behavior above was verified in the installed
build rather than inferred from that general documentation.

## Formatting and limits

- 256 retained entries per operator, each at most 4096 UTF-8 message bytes.
  Eviction removes the oldest entry. New writes use `try_lock`; if a snapshot or
  clear holds the storage lock, capture drops the new message instead of waiting.
- One fixed ring and one fixed Info DAT snapshot cost about **2.02 MiB** per
  operator (4128 bytes per native entry, 1,056,800 bytes per snapshot), plus small
  objects and temporary formatting. TD's own strings/table/viewer allocations
  are additional and bounded by that table's dimensions and message lengths.
  Diagnostics view reads counters only, avoiding the message snapshot copy.
- Formatting processes at most 16 arguments, 48 visited values, two object
  levels, eight members/elements per container, and 64 dictionary hash slots.
  Strings inspect at most 128 rope nodes and 4097 UTF-16 units, without flattening
  the entire input. Deep concatenation chains can show `[String preview limit]`.
  Large arrays/typed arrays show their length and omitted count. Dictionary
  previews are a bounded subset, not guaranteed insertion order. Plain-object
  numeric element storage is omitted; use arrays for indexed data previews.
- Plain data properties, accessor markers, cycles, primitives, arrays, typed
  arrays, Error name/message and available V8-captured stack frames are supported.
  Proxy and native/exotic objects get opaque markers. No getters, `toJSON`, custom
  `toString`, inspection hooks, proxy traps, or `Error.prepareStackTrace` run.
  Error stacks show at most four captured frames; no per-message stack capture
  or source-map resolution is performed.
- Strings retain newlines and Unicode; truncation respects UTF-8 boundaries.
  Embedded NUL becomes the visible text `\0` because TD strings are NUL-terminated.
  Values are captured at call time, not retained as live objects. Formatting
  failures do not become script exceptions.
- `%s`, `%d`, `%o`, colors, groups, and browser/Node substitution tokens are not
  interpreted. Arguments are joined with spaces. Only the five methods above
  are declared by the SDK; it still does not enable DOM/Node globals.
- Level filtering happens before argument inspection. JavaScript still evaluates
  call arguments, so `console.debug(expensive())` computes `expensive()` even when
  filtered. Guard that computation yourself when needed.

The bounded property preview uses the pinned V8's internal property descriptors
because its public enumeration API allocates the complete key list and UTF-8
conversion flattens entire string ropes. Keep that
small helper covered when updating V8. The ring has its own short mutex; logging
and Info DAT reads never acquire the runtime execution mutex. Clear linearizes
at the storage lock: accepted later entries remain, and a prior snapshot cannot
write anything back into storage.

Native callers: `avLogCreate`, `avLogAttach` before the first frame, `avLogLevel`,
`avLogRead` (or counters-only `avLogStats`), `avLogClear`, `avLogDestroy`. Snapshots use caller-owned storage.
The runtime retains shared ownership of the sink, so releasing the public
handle during pending timer work is safe. Attach is a one-time worker-synchronized
operation; reads and clears do not wait for that worker.

[Verification and timings](test/logging/README.md).
