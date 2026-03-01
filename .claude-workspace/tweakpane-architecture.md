# Tweakpane v4 Architecture Report

**Source:** `/Users/avneeshsarwate/agentCombine/avTools/clonedCompanionRepos/tweakpane/`
**Version:** 4.0.5 (monorepo), core 2.0.5

---

## 1. Core Architecture: Packages, Modules, Key Classes

### Monorepo Structure

The repo is a monorepo with two packages:

- **`@tweakpane/core`** (`packages/core/`) -- The framework: value system, binding system, plugin interfaces, blade/controller/view architecture, all built-in input/monitor plugins, constraint system. Published as a separate npm package. Built with plain `tsc`.
- **`tweakpane`** (`packages/tweakpane/`) -- The user-facing library: the `Pane` class, a few additional blade plugins (list, slider, separator, text blades), CSS bundling, and the documentation site. Built with Rollup (bundles `@tweakpane/core` inline via alias).

### Layered Architecture (MVC-ish)

Tweakpane follows a clear **Model-View-Controller** pattern, with an additional **API layer** on top:

```
User Code
   |
API Layer       (Pane, FolderApi, BindingApi, BladeApi, RackApi)
   |
Controller Layer (BladeController, RackController, FolderController,
                  InputBindingController, ValueControllers)
   |
Model Layer     (Value<T>, ValueMap, Emitter, Rack, Blade, Foldable,
                  InputBindingValue, MonitorBindingValue, BindingTarget)
   |
View Layer      (View interface, FolderView, LabelView, SliderView, etc.)
                  All views create and own DOM elements.
```

### Key Classes

| Class | Location | Role |
|---|---|---|
| `Pane` | `tweakpane/src/main/ts/pane/pane.ts` | Top-level entry point. Extends `RootApi`. Creates DOM wrapper, registers default plugins, injects CSS. |
| `RootApi` | `tweakpane/src/main/ts/blade/root/api/root.ts` | Extends `FolderApi`. Thin wrapper around `RootController`. |
| `FolderApi` | `core/src/blade/folder/api/folder.ts` | Extends `ContainerBladeApi`. Delegates to `RackApi` for `addBinding`, `addFolder`, `addButton`, etc. Has `on('change')` and `on('fold')`. |
| `RackApi` | `core/src/blade/common/api/rack.ts` | Implements `ContainerApi`. The workhorse: creates bindings, blades, buttons. Listens to `Rack.emitter` `'valuechange'` events and re-emits as `TpChangeEvent`. |
| `BindingApi` | `core/src/blade/binding/api/binding.ts` | Per-binding API. Has `on('change')`, `refresh()`, `key`, `label`, `tag`. Listens to `controller.value.emitter` for changes. |
| `BladeApi` | `core/src/blade/common/api/blade.ts` | Base API for all blades. Wraps a `BladeController`. Provides `element`, `disabled`, `hidden`, `dispose()`, `importState()`, `exportState()`. |
| `BladeController` | `core/src/blade/common/controller/blade.ts` | Base controller for all blades. Owns a `Blade` model, a `View`, and `ViewProps`. Manages CSS position classes. Handles disposal. |
| `BindingController` | `core/src/blade/binding/controller/binding.ts` | Extends `LabeledValueBladeController`. Wraps a `BindingValue` (input or monitor). Has `tag`. Handles import/export of binding state. |
| `InputBindingController` | `core/src/blade/binding/controller/input-binding.ts` | Extends `BindingController`. Specializes import to call `binding.inject()`. |
| `MonitorBindingController` | `core/src/blade/binding/controller/monitor-binding.ts` | Extends `BindingController`. Read-only. Exports `readonly: true`. |
| `Rack` | `core/src/blade/common/model/rack.ts` | Collection model. Manages child `BladeController`s in a `NestedOrderedSet`. Listens to child value changes and bubbles them as `'valuechange'` events. Manages blade position classes (first/last). |
| `RackController` | `core/src/blade/common/controller/rack.ts` | Owns a `Rack` and an `HTMLElement`. When blades are added/removed from the Rack, it inserts/removes their view elements from the DOM. |
| `Value<T>` | `core/src/common/model/value.ts` | Interface: `rawValue`, `setRawValue()`, `emitter` (with `'beforechange'` and `'change'`). |
| `PrimitiveValue<T>` | `core/src/common/model/primitive-value.ts` | Simple `Value<T>` implementation. Skips emit if `===` and `forceEmit` is false. |
| `ComplexValue<T>` | `core/src/common/model/complex-value.ts` | `Value<T>` with optional `Constraint` and custom `equals`. Constraint is applied before storing. |
| `ValueMap<O>` | `core/src/common/model/value-map.ts` | A typed map of `Value` objects. Used for component props (label, title, etc.). Has its own `emitter` that fires on any child value change. |
| `Emitter<E>` | `core/src/common/model/emitter.ts` | Simple typed event emitter with `on()`, `off()`, `emit()`. Supports key-based removal. |
| `BindingTarget` | `core/src/common/binding/target.ts` | Wraps `obj[key]`. Has `read()` and `write(value)`. This is the bridge to the user's bound object. |
| `InputBindingValue<T>` | `core/src/common/binding/value/input-binding.ts` | Wraps a `Value<T>` and a `ReadWriteBinding<T>`. On internal value change, calls `push()` to write back to the bound object. `fetch()` reads from the object into the value. |
| `MonitorBindingValue<T>` | `core/src/common/binding/value/monitor-binding.ts` | Wraps a `BufferedValue<T>`, a `ReadonlyBinding<T>`, and a `Ticker`. On each tick, calls `fetch()` to read the latest value from the bound object. |
| `ReadWriteBinding<T>` | `core/src/common/binding/read-write.ts` | Has `read()` (target.read -> reader), `write()` (writer -> target.write), `inject()` (reader + write). |
| `ReadonlyBinding<T>` | `core/src/common/binding/readonly.ts` | Has only `read()` (target.read -> reader). |
| `PluginPool` | `core/src/plugin/pool.ts` | Registry of input, monitor, and blade plugins. Used to create bindings, blade controllers, and API objects. Has an `BladeApiCache` for identity-stable API wrappers. |

---

## 2. Object Binding Model

### How Binding Works

When you call `pane.addBinding(params, 'speed')`, this happens:

1. **`RackApi.addBinding()`** creates a `BindingTarget(params, 'speed')`.
2. **`PluginPool.createBinding()`** reads the initial value via `target.read()` (i.e., `params.speed`), then iterates registered input plugins calling `plugin.accept(value, options)`.
3. The matching plugin creates:
   - A **`BindingReader`** function: converts external value to internal format.
   - A **`BindingWriter`** function: converts internal value and writes to target.
   - A **`ReadWriteBinding`** wrapping `(reader, writer, target)`.
   - An **`InputBindingValue`** wrapping `(Value<T>, ReadWriteBinding)`.
4. An `InputBindingController` is created with the `InputBindingValue` and a UI controller (e.g., `SliderTextController`).

### Two-Way Binding: UI -> Object

In `InputBindingValue` (file: `core/src/common/binding/value/input-binding.ts`):

```typescript
private onValueChange_(ev: ValueEvents<T>['change']): void {
    this.push();  // <--- writes to bound object
    this.emitter.emit('change', { ...ev, sender: this });
}

public push(): void {
    this.binding.write(this.value_.rawValue);
}
```

When the user drags a slider, the UI controller sets `value.rawValue = newValue`, which triggers the `PrimitiveValue`/`ComplexValue` change event, which triggers `InputBindingValue.onValueChange_()`, which calls `this.push()` -- writing back to `params.speed` via `BindingTarget.write()`.

**So yes, tweakpane writes changes back to the bound object automatically on every UI change.**

### Two-Way Binding: Object -> UI (External Changes)

**Tweakpane does NOT automatically detect external changes to the bound object.** There is no `Object.observe`, no `Proxy`, no polling for input bindings.

If external code does `params.speed = 42`, the tweakpane UI will NOT update automatically. The user must call:

```typescript
binding.refresh()  // on a specific binding
// or
pane.refresh()     // on the whole pane (recursively refreshes all children)
```

`BindingApi.refresh()` calls `this.controller.value.fetch()`, which reads the current value from the bound object:

```typescript
// InputBindingValue.fetch()
public fetch(): void {
    this.value_.rawValue = this.binding.read();
}
```

### Monitor Bindings (readonly: true)

Monitor bindings use a `Ticker` (usually `IntervalTicker` with `setInterval`) that periodically calls `MonitorBindingValue.fetch()`, reading the bound property on each tick. So monitors DO automatically reflect external changes, but only because they poll on an interval (default 200ms).

### Summary Table

| Direction | Input Binding | Monitor Binding |
|---|---|---|
| UI -> Object | Automatic (push on every change) | N/A (read-only) |
| Object -> UI | Manual (`refresh()`) | Automatic (polling via `Ticker`) |
| Detection method | None | `IntervalTicker` (setInterval) |

---

## 3. UI Creation and DOM Mounting

### Automatic DOM Creation

Every `View` creates its own DOM elements in its constructor. Views receive a `document` reference and use `document.createElement()`. For example, `FolderView` creates a `div` with CSS classes, a button for the title, and a container div for children.

The `RackController` (which is the workhorse for DOM management) listens to the `Rack` model's `'add'` and `'remove'` events and inserts/removes child view elements:

```typescript
// RackController
private onRackAdd_(ev: RackEvents['add']): void {
    if (!ev.root) return;
    insertElementAt(this.element, ev.bladeController.view.element, ev.index);
}
```

### Mounting

The `Pane` constructor handles mounting (file: `tweakpane/src/main/ts/pane/pane.ts`):

```typescript
constructor(opt_config?: PaneConfig) {
    // ...
    this.containerElem_ = config.container ?? createDefaultWrapperElement(doc);
    this.containerElem_.appendChild(this.element);
}
```

- **Default**: Creates a `<div class="tp-dfwv">` and appends it to `document.body`.
- **Custom container**: If `config.container` is provided, the pane's root element is appended to that container instead.

### CSS Injection

CSS is compiled from SCSS at build time and injected as a string literal into the JS bundle via Rollup's `Replace` plugin (`__css__` placeholder). At runtime, `Pane.setUpDefaultPlugins_()` calls `registerPlugin()` which calls `embedStyle()`, inserting a `<style data-tp-style="default">` element into `document.head`.

### PaneConfig Options

```typescript
interface PaneConfig {
    container?: HTMLElement;  // Custom container element
    expanded?: boolean;       // Initial expansion state
    title?: string;           // Pane title (makes it collapsible)
    document?: Document;      // Custom document reference (hidden API)
}
```

The `document` option is key for non-standard environments -- it lets you pass a JSDOM document or similar.

---

## 4. Event/Change Flow

### Internal Event Chain (UI Change)

Here is the complete chain when a user moves a slider:

```
1. PointerHandler detects mouse/touch drag
2. SliderView updates visual position
3. SliderController computes new value
4. Sets value.rawValue = newValue on the Value<number>
5. PrimitiveValue/ComplexValue.setRawValue():
   a. Applies constraint (ComplexValue only)
   b. Checks equality, skips if unchanged
   c. Emits 'beforechange'
   d. Stores new value
   e. Emits 'change' { rawValue, previousRawValue, options: { last, forceEmit } }
6. InputBindingValue.onValueChange_():
   a. Calls this.push() -> binding.write() -> target.write() -> obj[key] = value
   b. Re-emits 'change' on its own emitter
7. Rack.onChildValueChange_():
   a. Finds the BladeController that owns this value
   b. Emits 'valuechange' on Rack's emitter
8. (If nested) Parent Rack.onRackValueChange_():
   a. Bubbles 'valuechange' up to root Rack
9. RackApi.onRackValueChange_():
   a. Creates TpChangeEvent with the API object, the external value (reads target), and ev.options.last
   b. Emits 'change' on RackApi's emitter
10. FolderApi/Pane picks up 'change' from RackApi and re-emits on its own emitter
11. User's pane.on('change', handler) fires with TpChangeEvent
```

### The `options.last` Flag

The `last` flag indicates whether this is the final change in a drag/interaction sequence. During continuous dragging, `last` is `false`; on mouse-up, it becomes `true`. This is useful for undo systems or expensive operations.

### TpChangeEvent

```typescript
class TpChangeEvent<T, Target> extends TpEvent<Target> {
    value: T;     // The external value (read from the bound object)
    last: boolean; // Whether this is the final change in an interaction
    target: Target; // The BladeApi that emitted the change
}
```

### Event Listeners

- **Per-binding**: `binding.on('change', (ev) => { ev.value, ev.last, ev.target })`
- **Per-container (folder/pane)**: `folder.on('change', (ev) => { ... })` -- catches ALL descendant value changes
- **Fold events**: `folder.on('fold', (ev) => { ev.expanded })`
- **Tab events**: `tab.on('select', (ev) => { ev.index })`

### Important: The value in TpChangeEvent reads from the bound object

In `RackApi.onRackValueChange_()`:
```typescript
this.emitter_.emit('change', new TpChangeEvent(
    api,
    binding ? binding.target.read() : bc.value.rawValue,  // reads from obj[key]
    ev.options.last,
));
```

The event value is the **external** value read from the bound object (after the write-back), not the internal representation.

---

## 5. State Management Internals

### Internal Value Storage

Values are stored inside `Value<T>` objects (either `PrimitiveValue<T>` or `ComplexValue<T>`), which are owned by controllers. There is **no central value store**. Each binding has its own independent `InputBindingValue<T>` or `MonitorBindingValue<T>`.

The hierarchy is:

```
InputBindingValue<T>
  |-- value_: Value<T>  (PrimitiveValue or ComplexValue -- the "internal" value)
  |-- binding: ReadWriteBinding<T>
        |-- target: BindingTarget  (reference to obj[key])
        |-- reader_: BindingReader<T>  (external -> internal conversion)
        |-- writer_: BindingWriter<T>  (internal -> external write)
```

### Internal vs External Values

- **External value**: The raw value on the user's object (`obj[key]`). This is what the user sees.
- **Internal value**: The value inside `Value<T>`. For primitives (numbers, booleans, strings), these are the same. For colors, the external might be `0xff0000` (number) while the internal is an `IntColor` object.
- **Reader**: Converts external -> internal (e.g., `numberFromUnknown`, color string parsing).
- **Writer**: Converts internal -> external and writes to target (e.g., `writePrimitive` calls `target.write(value)`).

### Constraints

Constraints are applied inside `ComplexValue.setRawValue()` before the value is stored:

```typescript
const constrainedValue = this.constraint_
    ? this.constraint_.constrain(rawValue)
    : rawValue;
```

Available constraints: `RangeConstraint`, `DefiniteRangeConstraint`, `StepConstraint`, `ListConstraint`, `CompositeConstraint`. They are composed together (e.g., a number slider has both range and step constraints).

### ValueMap for Props

Component properties (like `label`, `title`, `expanded`) are stored in `ValueMap` objects. `ValueMap` is a typed map of `Value<T>` instances with its own change emitter. `ViewProps` extends `ValueMap<ViewPropsObject>` (with `disabled`, `hidden`, `disposed`, `parent`).

---

## 6. Plugin/Blade System

### Plugin Types

There are three plugin types:

1. **`InputBindingPlugin<In, Ex, P>`** -- For input controls (sliders, text fields, color pickers, checkboxes, dropdowns, point pads). These create `InputBindingController`s.
2. **`MonitorBindingPlugin<T, P>`** -- For read-only monitors (text log, graph). These create `MonitorBindingController`s.
3. **`BladePlugin<P>`** -- For standalone UI elements (buttons, folders, tabs, separators). These create `BladeController`s.

### Plugin Interface (Input Example)

```typescript
interface InputBindingPlugin<In, Ex, P> {
    id: string;
    type: 'input';
    core?: Semver;  // Core version compatibility check

    // Decides if plugin handles this value type + params
    accept(exValue: unknown, params: Record<string, unknown>):
        { initialValue: Ex; params: P } | null;

    binding: {
        reader(args): BindingReader<In>;    // external -> internal
        writer(args): BindingWriter<In>;    // internal -> write to target
        constraint?(args): Constraint<In>;  // value constraints
        equals?(v1: In, v2: In): boolean;   // equality check
    };

    // Creates the UI controller (slider, text field, etc.)
    controller(args): ValueController<In>;

    // Optional: creates a custom API wrapper
    api?(args): InputBindingApi | null;
}
```

### Plugin Registration Flow

1. `createDefaultPluginPool()` registers all core plugins (in `core/src/plugin/plugins.ts`):
   - Input: Point2d, Point3d, Point4d, String, Number, StringColor, ObjectColor, NumberColor, Boolean
   - Monitor: Boolean, String, Number
   - Blade: Button, Folder, Tab

2. `Pane.setUpDefaultPlugins_()` additionally registers tweakpane-specific blade plugins:
   - List, Separator, Slider, Tab, Text

3. Users can register custom plugins via `pane.registerPlugin(bundle)`.

### Plugin Matching

Plugins are tested in **reverse registration order** (most recently registered wins). `PluginPool.createBinding()` iterates input plugins, calling `accept()` with the initial value and params. The first non-null result wins. If no input plugin matches, it tries monitor plugins. This is how `readonly: true` works -- it causes input plugins to reject, and monitor plugins to accept.

### Blade Rendering

Each plugin's `controller()` function creates a `ValueController` with a `View`. Views create DOM elements in their constructors. The view is then wrapped in a `LabelView` (which provides the label column), and the `LabeledValueBladeController` manages the composition.

### Built-in Input Plugins

| Plugin | Accepts | UI |
|---|---|---|
| `NumberInputPlugin` | `typeof value === 'number'` | Slider+text, text-only, or dropdown |
| `BooleanInputPlugin` | `typeof value === 'boolean'` | Checkbox |
| `StringInputPlugin` | `typeof value === 'string'` | Text input or dropdown |
| `StringColorInputPlugin` | String matching color format | Color picker |
| `NumberColorInputPlugin` | Number with `color: {type: ...}` | Color picker |
| `ObjectColorInputPlugin` | `{r,g,b}` or `{r,g,b,a}` object | Color picker |
| `Point2dInputPlugin` | `{x, y}` object | 2D pad + text |
| `Point3dInputPlugin` | `{x, y, z}` object | 3-axis text |
| `Point4dInputPlugin` | `{x, y, z, w}` object | 4-axis text |

---

## 7. Build System

### Core Package (`@tweakpane/core`)

- Built with plain `tsc` (TypeScript compiler).
- Output: `dist/` with `.js` and `.d.ts` files (ES modules).
- SCSS library in `lib/sass/` -- provides SCSS mixins/variables for plugin themes.
- No bundling -- consumers import directly from the compiled output.

### Tweakpane Package

- Built with **Rollup** (`rollup.config.js`).
- `@tweakpane/core` is aliased and inlined (not an external dependency in the bundle).
- SCSS is compiled with **Sass**, post-processed with **Autoprefixer/PostCSS**, then the minified CSS string is injected into the JS bundle via Rollup's `Replace` plugin (replacing the `__css__` placeholder).
- Output: single ESM file `docs/assets/tweakpane.js` (dev) or `tweakpane.min.js` (prod).
- TypeScript declarations generated separately with `tsc --project tsconfig-dts.json`.
- Version string `0.0.0-tweakpane.0` is replaced with the real version at build time.

---

## 8. Fork vs Wrapper Analysis for WebSocket Sync

### Where Value Changes Flow

The critical chokepoint for intercepting ALL value changes is in the `Rack` model. When any child blade's value changes, the `Rack.onChildValueChange_()` method fires:

```typescript
// core/src/blade/common/model/rack.ts
private onChildValueChange_(ev: ValueEvents<unknown>['change']) {
    const bc = findValueBladeController(this.find(isValueBladeController), ev.sender);
    this.emitter.emit('valuechange', {
        bladeController: bc,
        options: ev.options,
        sender: this,
    });
}
```

This bubbles up through nested Racks to the root. The `RackApi` then converts this to a `TpChangeEvent`.

### Clean "Value Changed" Hook

**Yes, there is a clean low-level hook.** The `RackApi` (which is what `FolderApi`/`Pane` delegates to internally) already listens to `rack.emitter.on('valuechange', ...)` and emits `'change'` events. At the public API level:

```typescript
pane.on('change', (ev) => {
    // ev.target is the BladeApi for the changed binding
    // ev.value is the external value
    // ev.last indicates end of drag
    // ev.target.key gives you the property name
});
```

This captures ALL value changes from all descendants (it bubbles).

### Wrapper Approach (Recommended)

A wrapper around `Pane` can intercept all mutations **without forking**:

```typescript
class SyncedPane {
    private pane: Pane;
    private ws: WebSocket;
    private suppressSync = false;

    constructor(config) {
        this.pane = new Pane(config);
        this.ws = new WebSocket(url);

        // Intercept all outgoing changes
        this.pane.on('change', (ev) => {
            if (this.suppressSync) return;
            this.ws.send(JSON.stringify({
                key: ev.target.key,
                value: ev.value,
                last: ev.last,
            }));
        });

        // Receive remote changes
        this.ws.onmessage = (msg) => {
            const { key, value } = JSON.parse(msg.data);
            this.suppressSync = true;
            // Update the bound object
            this.boundObject[key] = value;
            // Refresh the pane UI
            this.pane.refresh();
            this.suppressSync = false;
        };
    }
}
```

**Key advantages of wrapper approach:**
- `pane.on('change')` already captures ALL value changes from all descendants.
- `pane.refresh()` re-reads all bound objects and updates the UI.
- The `suppressSync` flag prevents echo loops.
- No fork maintenance burden.
- Works with any tweakpane version and plugins.

**Limitations of wrapper approach:**
- `ev.target.key` gives the property key, but if you have the same key in multiple bindings, you need more context (e.g., the `tag` property on bindings, or path-based identification).
- `pane.refresh()` refreshes ALL bindings, not just the one that changed. For targeted refresh, you would need to track individual `BindingApi` references.
- Button clicks and fold events need separate handling.

### Alternative: Using exportState/importState

For full state sync (not just individual values), you could use the serialization API:

```typescript
// Export full state
const state = pane.exportState();
ws.send(JSON.stringify(state));

// Import full state
const state = JSON.parse(msg.data);
pane.importState(state);
```

This captures everything: values, disabled state, hidden state, folder expansion, etc.

### Fork Approach

If you forked, the ideal interception point would be in `InputBindingValue.onValueChange_()`:

```typescript
// core/src/common/binding/value/input-binding.ts
private onValueChange_(ev: ValueEvents<T>['change']): void {
    this.push();
    // >>> INSERT SYNC HOOK HERE <<<
    this.emitter.emit('change', { ...ev, sender: this });
}
```

Or in `Rack.onChildValueChange_()` for a centralized point.

**Forking disadvantages:**
- Must maintain fork across updates.
- Core changes for sync leak into the view library.
- The wrapper approach is just as effective.

### Recommendation

**Use the wrapper approach.** The public API already provides everything needed:
- `pane.on('change')` for outgoing changes
- `pane.refresh()` for incoming changes (after updating the bound object)
- `pane.exportState()` / `pane.importState()` for full state sync
- `binding.tag` for disambiguation of same-key bindings

---

## 9. Serialization

### Export/Import State API

Every `BladeApi` has `exportState()` and `importState()`:

```typescript
// BladeApi
public importState(state: BladeState): boolean {
    return this.controller.importState(state);
}
public exportState(): BladeState {
    return this.controller.exportState();
}
```

`BladeState` is `Record<string, unknown>` -- a plain JSON-serializable object.

### What Gets Serialized

**`BladeController.exportState()`** exports:
- `disabled: boolean`
- `hidden: boolean`

**`BindingController.exportState()`** additionally exports:
- `binding: { key: string, value: unknown }` -- the property key and its current value
- `tag: string | undefined`

**`ContainerBladeController.exportState()`** (folders, tabs) additionally exports:
- `children: BladeState[]` -- recursive state of all children

**`FolderController.exportState()`** additionally exports:
- `expanded: boolean`
- `title: string | undefined`

**`LabeledValueBladeController.exportState()`** additionally exports:
- `value: T` (the raw internal value)
- Label props

### Import Flow

`importState()` uses a micro-parser system to validate the state object before applying it. The `importBladeState()` utility function chains super-class imports:

```typescript
importBladeState(state, superImport, parser, callback)
```

For `InputBindingController`, import does:
```typescript
this.value.binding.inject(result.binding.value);  // reader(value) then write
this.value.fetch();  // re-read from target
```

This means importing state writes the value through the full reader/writer pipeline, maintaining constraints.

### Preset Utility (Documentation Code)

The doc source includes a `preset.ts` utility (at `tweakpane/src/doc/ts/preset.ts`) that converts between state and preset objects:

```typescript
stateToPreset(state)    // BladeState -> { key: value, ... }
presetToState(state, preset)  // Merge preset values into state
```

This is useful for save/load workflows but is part of the documentation, not the core library.

### Serialization for WebSocket Sync

The state is plain JSON, so it is directly serializable:
```typescript
const stateJson = JSON.stringify(pane.exportState());
// ... send over WebSocket ...
pane.importState(JSON.parse(stateJson));
```

---

## 10. Headless / Server-Side Considerations

### DOM Dependency

Tweakpane is **deeply coupled to the DOM**. Every aspect depends on `Document` and `HTMLElement`:

- **Views**: All views create DOM elements in constructors (`doc.createElement()`).
- **Controllers**: Many controllers reference `element.ownerDocument`.
- **Pane constructor**: Calls `doc.createElement('div')`, `doc.body.appendChild()`, `doc.head.appendChild()` (for CSS).
- **RackController**: Calls `insertElementAt()` / `removeElement()` for DOM manipulation.
- **IntervalTicker**: Uses `win.setInterval` via `doc.defaultView`.
- **CSS injection**: `embedStyle()` creates `<style>` elements.
- **Pointer handling**: PointerHandler listens to pointer events on DOM elements.
- **SVG icons**: Created with `doc.createElementNS()`.
- **getWindowDocument()**: Falls back to `globalThis.document`.

### Can It Run Without a Real DOM?

**Not out of the box, but with JSDOM it can.** The test suite uses JSDOM (listed as a devDependency). The `PaneConfig.document` option was specifically designed for this:

```typescript
const doc = new JSDOM('<!DOCTYPE html><html><body></body></html>').window.document;
const pane = new Pane({ document: doc });
```

The DOM structure will be created in the JSDOM, but no visual rendering happens.

### Server-Side "Headless" Pane

For a Deno notebook with WebSocket sync, you have two realistic approaches:

**Approach A: Server-side pane with JSDOM/LinkeDOM**
- Use a lightweight DOM implementation (JSDOM, LinkeDOM, happy-dom).
- Create a `Pane` with the virtual document.
- Use `exportState()`/`importState()` for sync.
- The pane manages all the binding/value logic, just without visual rendering.
- Caveat: JSDOM is heavy. LinkeDOM is lighter. Some DOM APIs may be missing.

**Approach B: No server-side pane -- pure data sync**
- On the server, just manage a plain object with values.
- The client runs the real tweakpane `Pane`.
- WebSocket sync only carries the bound object's values.
- Server writes values to the object; client sends changes back.
- This avoids DOM entirely on the server.

**Approach B is recommended** for a Deno notebook use case. The server/notebook just needs the parameter values, not the tweakpane UI. The UI runs in the browser.

### Key DOM-Dependent Spots

| Component | DOM Usage | Can Be Avoided? |
|---|---|---|
| `Pane` constructor | `createElement`, `body.appendChild`, `head.appendChild` | Yes with custom `container` and `document` |
| Views | `createElement` in constructors | No -- core to the architecture |
| RackController | `insertBefore`, `removeChild` | No -- core to the architecture |
| IntervalTicker | `setInterval` via `doc.defaultView` | `ManualTicker` alternative exists |
| CSS injection | `createElement('style')`, `head.appendChild` | Can be skipped if no visual needed |
| PointerHandler | `addEventListener` on DOM elements | Not needed headlessly |

---

## Summary: Architecture Diagram

```
Pane (entry point)
 |
 |-- RootApi extends FolderApi
 |    |
 |    |-- FolderApi extends ContainerBladeApi
 |    |    |-- on('change') / on('fold')
 |    |    |-- delegates to RackApi
 |    |
 |    |-- RackApi (implements ContainerApi)
 |         |-- addBinding() -> PluginPool.createBinding()
 |         |-- addFolder() / addButton() / addBlade()
 |         |-- listens to Rack.emitter 'valuechange'
 |         |-- emits TpChangeEvent
 |
 |-- RootController extends FolderController
      |
      |-- FolderController extends ContainerBladeController
           |-- RackController
           |    |-- Rack (model)
           |    |    |-- NestedOrderedSet<BladeController>
           |    |    |-- listens to child Value changes
           |    |    |-- bubbles 'valuechange' events up
           |    |
           |    |-- HTMLElement (container for child views)
           |
           |-- Each child is a BladeController:
                |
                |-- InputBindingController (for addBinding)
                |    |-- InputBindingValue<T>
                |    |    |-- Value<T> (internal, constrained)
                |    |    |-- ReadWriteBinding<T>
                |    |         |-- BindingTarget(obj, key)
                |    |         |-- reader, writer
                |    |-- ValueController (SliderText, Checkbox, etc.)
                |         |-- View (creates DOM elements)
                |
                |-- MonitorBindingController (for readonly bindings)
                |    |-- MonitorBindingValue<T>
                |    |    |-- BufferedValue<T>
                |    |    |-- ReadonlyBinding<T>
                |    |    |-- Ticker (polls value)
                |
                |-- Other BladeControllers (Button, Folder, Tab, etc.)
```

### Key Takeaways for WebSocket Sync Use Case

1. **`pane.on('change', handler)`** is the single interception point for all value changes.
2. **`pane.refresh()`** updates the UI from the bound object -- call after receiving remote changes.
3. **`exportState()`/`importState()`** provide full serialization for complete state transfer.
4. **A wrapper is cleaner than a fork** -- the public API already exposes everything needed.
5. **DOM is required** for tweakpane itself, but the server/notebook side only needs the plain data object.
6. The `PaneConfig.document` option enables JSDOM-based usage if a headless pane is truly needed.
7. `binding.tag` can be used to disambiguate bindings with the same key name.
