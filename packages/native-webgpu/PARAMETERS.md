# Script-declared TouchDesigner parameters

The avTools TOP and CHOP accept a literal `parameters` export in the TypeScript
entrypoint. The native builder extracts this data without executing the sketch.
Controls appear directly on the operator's **Controls** page by default.

```ts
import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';
import type {ChopHost} from '@avtools/native-webgpu/td-chop';

export const parameters = {
  Gain: {type: 'float', default: 1, min: 0, max: 4},
  Enabled: {type: 'toggle', default: true},
  Mode: {type: 'menu', options: ['multiply', 'add']},
  Trigger: {type: 'pulse', label: 'Restart Animation'},
} as const satisfies ParameterDefinitions;

type Host = ChopHost<typeof parameters>;
export function onCook(host: Host) {
  const p = host.params;
  const input = host.inputs.get('value');
  host.outputs.set('value', !p.Enabled ? input
    : p.Mode === 'multiply' ? input * p.Gain : input + p.Gain);
}
export function onPulse(name: string, host: Host) {
  if (name === 'Trigger') console.log('Trigger', host.params.Gain);
}
```

Set the CHOP's Output Channels to `value`. Select the `.ts` entry on its Build
page. The first successful compilation installs the controls automatically.

For a TOP, use `Draw<typeof parameters>` and read `frame.params`. Setup and
asynchronous timing functions can use `SketchHost<typeof parameters>.params`.
The CHOP exposes the same data through `ChopHost<typeof parameters>.params`.

## Values and timing

Values are sampled through TD's native `OP_Inputs` API with the other inputs of
an accepted cook. There is no Python call in ordinary parameter sampling and no
additional frame delay. Existing execution modes still apply: a blocking CHOP
uses this cook's parameters; buffered operators use their accepted input snapshot.

`host.params` is a getter for the latest worker-accepted snapshot. Read it again
after an `await` to see newer values. Holding `const old = host.params` intentionally
retains the old snapshot. TOP `frame.params` belongs to that draw. Records and
vector/color arrays are frozen. Missing undeclared fields are `undefined` at
runtime; the generic types reject unknown names at build time. Pulse parameters
are events, not values: they invoke the existing `onPulse` callback with their
exact name, in the same bounded FIFO as Send Pulse.

RGB/RGBA are read in TD's working color space. Nonfinite numeric parameter
expressions are converted to zero when sampling.

## Supported declarations

Every control supports `type`, optional `label`, and optional `page`.

| Type | Value/default | Options |
| --- | --- | --- |
| `float`, `int` | number; default 0 | `min`, `max`, `clamp` |
| `toggle` | boolean; default false | |
| `string` | string; default empty | |
| `menu` | option string; default first option | required `options`, optional matching `labels` |
| `xy` | readonly pair; default zeros | `min`, `max`, `clamp` |
| `xyz`, `rgb` | readonly triple; default zeros | `min`, `max`, `clamp` |
| `rgba` | readonly quadruple; default zeros | `min`, `max`, `clamp` |
| `pulse` | delivered to `onPulse(name, ...)` | |

Numeric bounds default to 0–1 and affect the slider. `clamp: true` also limits the
value. Bounds apply to every tuple component. Integer defaults must fit int32.

Names must start with an uppercase letter followed by lowercase letters/digits
(e.g. `Speed`, `Bpm`, `Offset2`). Host control names and tuple component names
cannot collide. Use a separate page from the built-in Build/Sketch/Script/Output/
Logging pages. Maximum 64 declarations and 32 KiB metadata per entry.

The entry must contain **`export const parameters = { ... }`** directly. `as const`
and `satisfies ParameterDefinitions` work. Values must be literal objects, arrays,
strings, finite numbers, or booleans. Spreads, functions, imported schemas,
references, computed keys and re-exports are rejected. This restriction applies
only to UI metadata; ordinary sketch imports and npm packages work as before.
Legacy raw-JS/DAT scripts without builder metadata have no declared controls.

## Editing and persistence

* Same names and types retain TD values, expressions, exports and bindings.
* New names receive their defaults; removed names disappear. Changed defaults
  update the definition without overwriting a user's edited value.
* Changing a type under the same name is rejected. Rename it to migrate, then
  reconnect any expressions/exports/bindings as needed.
* Ordinary code edits follow the existing JavaScript reload path. A changed
  declaration requires native reinitialization and restarts the script; expect
  a brief interruption rather than steady-state frame overhead.
* Automatic Reload off keeps the active code and schema together. Reload adopts
  the selected successful revision; Reset restarts the active revision. Queued
  pulses survive the schema transition. The selected revision is handed across
  native recreation, even if another build finishes meanwhile.
* Compile or declaration-validation errors leave the active code/UI intact and
  report diagnostics. Runtime setup/draw errors after activation do not roll
  back the newly installed schema.
* Accepted schemas are stored in namespaced `OP.storage`, allowing saved
  `.toe`/`.tox` files to restore their controls before the compiler starts.
  Active JS state is not serialized. Missing source still prevents execution,
  but saved controls remain available.

Open [Parameters.toe](native/td/parameter-example/Parameters.toe) in this repository
for a ready-to-use TOP/CHOP example.

Create Template Project includes `sketches/parameters/picture.ts` and
`sketches/parameters/channels.ts` examples. For an older generated project, create
a new template in an empty folder and copy its `sdk/` into the existing project
(after preserving any deliberate local SDK edits). New typings are not silently
installed over user-owned project files.

Implementation: `native/td/DeclaredParameters.{h,py}`, the native builder's
`src/parameters.rs`, and `td-parameters.d.ts`. Test sources live under
`test/declared-parameters`; integration results distinguish live TD tests from
compiler/native-only checks.
