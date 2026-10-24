# Script-declared parameter investigation (historical probes)

Tested in the real TouchDesigner **2025.31550** editor on macOS Apple Silicon,
2026-10-23. These are experimental probes from before implementation. Production declaration
code and tests now live in `../declared-parameters/`; see that directory for the
current validation status. The findings below describe the original probes.

## Findings

| Operation | Observed result |
| --- | --- |
| C++ `setupParameters()` followed by Re-Init Class | Adds/removes parameters and changes definitions on the existing node. |
| Same name and type | Constant value, Python expression, CHOP export, and binding survive. Tested with the actual TOP and CHOP runtime. |
| New default / slider range | Definition updates; an existing edited value remains. |
| New parameter | Receives its declared default. |
| Removed parameter | Disappears. |
| Float → string under the same name | TD silently converted `42` to `"42"`; do not depend on this as a migration policy. |
| Native reinitialization | Destroys/recreates the C++ instance; the probe's counters reset. The real plugins also recreate their JS runtime and compiler subscription. |
| Ordinary TypeScript reload | Restarts JS, but does not call native `setupParameters()` or refresh the controls. |
| TypeScript compile error | Existing running script and controls remain. |
| Automatic Reload off | Successful new build remains pending until Reload. **Native Re-Init bypasses this distinction**: the current implementation adopts the latest successful source on startup. |
| `.tox` save/load | Tested values, expressions, export modes and bindings survive; copied instances are independent. |
| Read TypeScript/entry parameter during `setupParameters()` | Fails, including during Re-Init and saved component load. Old parameter definitions are unavailable at that point. |
| Read `node.storage` during `setupParameters()` | Works through TD's Python C API. A stored schema selector survived Re-Init and `.tox` save/load and rebuilt the correct controls with their saved values. |
| Python `appendCustomPage` / `destroyCustomPars` on CPlusPlus nodes | Not available. |
| Python edit label/range/default or destroy a C++ parameter | Rejected as requiring a custom/sequential parameter. C++-defined controls are not in the Python `customPars` collection. |

One sample of native Re-Init plus an immediate cook measured **44.9 ms CHOP**
and **57.5 ms TOP** (64×64). This includes teardown/setup work; it is not a
steady-state parameter-read cost or a comprehensive performance benchmark.
The first successful CHOP output after that pair of reinitializations was observed
about 182 ms later, including recompilation, scheduling, and waiting for timer ticks.
Schema changes can therefore cause a noticeable reload interruption.

The runtime test used modified copies of the real plugins, with test controls
read from `artifacts/parameters/schema.txt` inside `setupParameters()`. Their
normal native TS compiler, automatic/manual reload, timers, pulses, and rendering
were used. The TS fixture exports a declaration object and consumes it in its
script, but **automatic extraction/transport of that object into C++ is not part
of this probe**. The probe file stands in for that bridge.

## Recommended implementation

Keep the declaration in the TypeScript entry, for example an exported typed
`parameters` object with stable names, types, defaults, labels, ranges and menus.
This is a proposed API, not a supported import yet.

1. Compile a candidate source revision and obtain a validated, normalized
   declaration. Validate names, reserved controls, types, tuple sizes, menu entries,
   and finite/range values before changing any TD controls. Module-level code
   must not be evaluated twice merely to inspect declarations. Decide between a
   restricted build-time declaration format and a staged JS evaluation protocol;
   arbitrary computed declarations require more lifecycle work than a literal.
2. Compare its schema hash with the **active**, per-instance declaration. A normal
   code-only save uses the existing JS reload path, with no native reinitialization.
3. With Automatic Reload off, retain both the candidate code and declaration as
   pending. Neither changes the active controls. Reset uses the active pair;
   Reload adopts the selected candidate pair. Compile/schema errors leave the
   active pair intact. Runtime setup errors need an explicit policy consistent
   with the existing activation behavior; rollback is not established by these tests.
4. For a changed declaration, persist the accepted schema in a namespaced
   `OP.storage` entry. Arrange a deferred reinitialization on TD's callback thread,
   after the current plugin callback has returned. Never synchronously destroy
   the plugin from inside its own cook/pulse callback or touch TD from a V8 worker.
5. The new `setupParameters()` reads the stored schema, then creates the fixed
   host controls and the declared page. The stored declaration is also present
   when a `.toe`/`.tox` is opened, before the compiler has started. Test recovery
   with missing sources, old storage versions and unknown schema fields.
6. Preserve the exact accepted source revision across the native restart in a
   handoff keyed to the operator identity. Do not simply resubscribe and adopt
   whichever source happens to be latest: the pending-reload test proves that
   would violate Automatic Reload/Reset semantics. Also account for queued pulses,
   TOP work in flight, stale worker results, and simultaneous edits.
7. Snapshot evaluated parameter values through `OP_Inputs` on TD's callback
   thread and deliver them with the accepted input/frame snapshot. Expose a typed
   `host.params` view in JS. Dispatch declared pulse buttons through the existing
   pulse queue, so handlers see the corresponding snapshot. Reading numeric
   parameters does not require GPU transfer or an additional frame of latency.

Preserve compatible existing values and connections by stable name. Treat rename
as removal plus addition unless an explicit migration is provided. For v1, reject
incompatible type/tuple changes with a clear error or require an explicit reset;
TD's implicit conversion is too surprising to make the default. Schema refresh
should occur only on accepted reload, not on every cook.

If eliminating the native restart interruption becomes important, a Base COMP
wrapper with Python-managed controls is an alternative. This investigation
establishes a workable route for controls directly on the existing CPlusPlus node.

## Reproduce

These probes are deliberately separate from `td:build` / `td:pack`; they do not
replace shipped binaries or increment the release version. Sources are in this
directory. Probe builds and generated projects/results go under ignored
`packages/native-webgpu/artifacts/parameters`.

From the repository root, with native plugin prerequisites available:

```sh
node packages/native-webgpu/test/parameters/build-probe.mjs
node packages/native-webgpu/test/parameters/build-runtime-probes.mjs
node packages/native-webgpu/test/parameters/build-bootstrap.mjs
```

Close/destroy any previous probe instances before rebuilding their binaries.
The Python fixtures currently contain the local repository path in `ROOT`/`OUT`;
adjust those constants when using another checkout. Run each through the TD
Textport, for example:

```python
exec(compile(open('/path/to/avTools/packages/native-webgpu/test/parameters/inspect.py').read(), 'parameter-test', 'exec'))
```

Run `inspect.py`, `lifecycle.py`, `runtime_setup.py`, wait for
`PARAMETER RUNTIME PASS`, then `persistence.py`, `bootstrap.py`, `storage.py`, and
`pending_reload.py`. The runtime test creates temporary sources/templates under
`artifacts/parameters`; remove those generated runtime folders before rerunning
from scratch, because Create Template Project correctly refuses to overwrite them.
`runtime_callbacks.py` is loaded by `runtime_setup.py`, not run directly.

The fixture occupies only `/avtools_parameter_probe`, leaving the existing
project's operators untouched. Persistence tests load and destroy an additional
copy. `Parameters.tox` is an experimental local fixture requiring the probe builds
and generated source folders. Disable/remove the test Execute DAT before saving
it for later use. Destroy the isolated base after testing to stop its workers.

Recorded evidence is in [results.json](results.json), including successful
TOP/CHOP runtime and persistence checks, the type conversion behavior, the
parameter-bootstrap failure, storage recovery, and the pending-reload hazard.
These checks ran in the editor; TouchEngine was not needed for this investigation.

API references: [C++ plugin parameters](https://derivative.ca/UserGuide/Write_a_CPlusPlus_Plugin),
[CPlusPlus TOP reinitialization](https://derivative.ca/UserGuide/CPlusPlus_TOP),
[CHOP export by channel name](https://docs.derivative.ca/CHOP_Export).
