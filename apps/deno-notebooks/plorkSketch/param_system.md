# paramSystem — dense reference

Source: `../tools/paramSystem.ts`. Declarative `ParamDefs` → three outputs: mutable `params` object, tweakpane UI, animation-editor track inputs.

## ParamDefs shape

```ts
type ParamDefs = Record<string, ParamDef | ParamDefFolder>;

type ParamDef = NumberParamDef | BooleanParamDef | StringParamDef;

interface NumberParamDef  { value: number; min: number; max: number; step?: number; label?: string }
interface BooleanParamDef { value: boolean; label?: string }
interface StringParamDef  { value: string; options: Record<string, string>; label?: string }

interface ActionDef { action: () => void; label?: string }

interface ParamDefFolder {
  _folder: string;                              // required — tweakpane folder title
  _actions?: Record<string, ActionDef>;          // buttons + func-tracks
  [leafKey: string]: ParamDef | ParamDefFolder | Record<string, ActionDef> | string | undefined;
}
```

### Leaf key inference

- `typeof value === "number"` → NumberParamDef. `min`/`max` **required** — throws if missing or non-finite.
- `typeof value === "boolean"` → BooleanParamDef. Generates an `enum` track with options `["true", "false"]`.
- `typeof value === "string"` with `options: Record<label, storedValue>` → StringParamDef. Generates an enum track over `Object.values(options)`.

### Flat namespace

**All leaf keys must be globally unique.** Folders are UI grouping only; `params.orbitRadius` is valid regardless of nesting depth. Duplicate leaf key → throws at `buildParamSystem`.

## Example

```ts
const paramDefs = {
  launch: {
    _folder: "Launch",
    duration: { value: 2.0, min: 0.1, max: 10, step: 0.1 },
    radius: { value: 20, min: 1, max: 200, step: 1 },
    hue: { value: 180, min: 0, max: 360, step: 1 },
    randomColor: { value: false },
    _actions: {
      launchRight: { action: () => launchCircle("right"), label: "Right" },
    },
  },
  animations: {
    _folder: "Animations",
    bwMode: { value: "orbit", options: { Orbit: "orbit", Walk: "walk" } },
    orbit: {
      _folder: "Orbit",
      orbitRadius: { value: 150, min: 0, max: 400, step: 1 },
      orbitSpeed: { value: 1.0, min: -5, max: 5, step: 0.05 },
    },
  },
} as const;

type SketchParams = {
  duration: number; radius: number; hue: number; randomColor: boolean;
  bwMode: "orbit" | "walk"; orbitRadius: number; orbitSpeed: number;
};
```

## buildParamSystem

```ts
const paramSystem = buildParamSystem(paramDefs);
// paramSystem: {
//   params:       Record<string, ParamValue>        // mutable flat map of leaf values
//   trackInputs:  TrackInput[]                       // one per leaf + one per action
//   paramMeta:    Map<string, ParamDef>              // leaf name → original def
//   actionMap:    Map<string, () => void>            // action name → callback
//   setupPane:    (pane) => Map<string, PaneBinding> // populates the tweakpane
// }

const params = paramSystem.params as SketchParams;   // cast for typed access
```

## Using params in the sketch

- Read: `params.orbitRadius` — normal property access.
- Write (programmatic): mutate the property, then `paneBindings.get("orbitRadius")?.refresh()` so the slider updates.
- Animation playback writes params automatically via `createAnimationCallbacks` (see below).

## setupPane wiring

Pass it into the `pane.setup` callback of `createWindowRenderManager`:
```ts
const paneBindings = new Map<string, PaneBinding>();

await createWindowRenderManager({
  /* … */
  pane: {
    title: "…",
    panelWidth: 420, panelHeight: 300,
    setup: (pane) => {
      const next = paramSystem.setupPane(pane);
      paneBindings.clear();
      for (const [k, b] of next) paneBindings.set(k, b);
    },
  },
});
```

`setupPane` recursively builds folders, adds typed bindings (numeric slider for numbers, dropdown for enums, checkbox for bools), and attaches action buttons that fire the raw action callbacks.

## createAnimationCallbacks

```ts
const callbacks = createAnimationCallbacks(
  params,
  paneBindings,       // so param-track updates can .refresh() the slider
  paramSystem.paramMeta,
  paramSystem.actionMap,
  syncRef,            // { enabled: boolean }
);
animationHandle.setCallbacks(callbacks);
```

The callbacks do three things:

- `updateNumber(trackName, value)` — writes `params[trackName] = value`, refreshes pane if `syncRef.enabled`.
- `updateEnum(trackName, value)` — writes `params[trackName] = value` (string, or `value === "true"` coerced to bool for boolean params).
- `updateFunc(_trackName, funcName)` — calls `actionMap.get(funcName)?.()`. Fired by func-track keyframes in the animation editor.

`syncRef.enabled` is flipped by the animation editor's sync toggle — when `false`, param changes from playback skip the tweakpane refresh (useful when dragging a slider while a track is playing).

## snapshotToAnimation

Writes current param values as keyframes at `time`:
```ts
snapshotToAnimation(
  params,
  paramSystem.paramMeta,
  bridge.tracks,        // TrackMap
  animationName,        // e.g., "default"
  time,                 // seconds
);
```

- Number tracks: keyframe at `time` with the current number. Existing keyframe at the same time is replaced.
- Enum tracks: keyframe with the current string (for booleans, `"true"`/`"false"`).
- Func tracks: untouched (functions don't snapshot state; they fire only on explicit keyframe creation).

Already wired via `createAnimationEditorBridge({ management: { snapshotCurrentState } })`.

## Gotchas

- `min`/`max` must be finite for number params. `Infinity`/`NaN` throws.
- Enum param's `options` value (the stored value) appears in `params`, not the label: `params.bwMode === "orbit"`, not `"Orbit"`.
- Folder key in the tree is arbitrary; only `_folder` matters for display.
- Nested folders work by using another `_folder` key inside.
- `_actions` is per-folder; actions live alongside params in that folder.
