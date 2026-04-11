# Animation Editor — Selector & Annotation Cheat Sheet

This file documents the `data-*` attribute conventions used throughout the animation editor components. Its purpose is to give coding agents (and a human in dev tools) a stable, greppable vocabulary for addressing UI elements — for design review, automated screenshotting, and programmatic flow triggering.

If you add new interactive controls, semantic regions, or identity carriers, **update this file as part of the same edit**. A stale cheat sheet causes agents to miss hooks or reference things that no longer exist.

## Why this exists

Vue's scoped-style hashing (`data-v-xxxxxxx`) is opaque — when you inspect an element, nothing on the DOM tells you which `.vue` file it came from or what sub-section it belongs to. The attributes documented here close that gap so you can:

- Walk up the DOM in plain dev tools and see a clean `data-component` ancestry chain (no Vue Devtools required).
- Point a coding agent at a precise sub-section of a large component without splitting files.
- Drive flows programmatically via Playwright (`page.getByTestId()` is first-class for `data-testid`).
- Query entities by identity (`[data-track-id="rotation"]`) without counting `nth-child`.

## Attribute families

Four independent namespaces, by intent:

| Attribute        | Purpose                                       | Where applied                                     |
|------------------|-----------------------------------------------|---------------------------------------------------|
| `data-component` | Names the owning `.vue` file                  | Root element of every component                  |
| `data-region`    | Names semantic sub-sections within a component| Meaningful inner containers                       |
| `data-testid`    | Names interactive controls for automation     | Buttons, inputs, checkboxes, handles              |
| Identity / state | Identifies entities and mirrors reactive state| Track rows, lane wrappers, modal, etc.            |

### Rules for future additions

- `data-component` is always the plain component filename without extension: `TrackRow`, not `track-row` or `TrackRow.vue`.
- `data-region` uses kebab-case, descriptive: `sidebar-number-section`, not `numSection`.
- `data-testid` uses kebab-case action/role names: `precision-save`, `bounds-low`. Prefer verbs for actions.
- Identity payloads use their schema key directly: `data-track-id`, `data-element-id`.
- Boolean state attributes use `|| undefined` to omit the attribute when false — that makes `[data-front]` a working truthy selector: `:data-front="isFront(track) || undefined"`.
- `data-testid` is chosen (not `data-test` or `data-qa`) so Playwright's `page.getByTestId()` works out of the box.
- Do **not** rename the existing `:data-version="trackDataVersion"` prop on `<EditModeView>` — it's a Vue prop binding (declared in `defineProps` as `dataVersion: number`), not a DOM data attribute, and renaming would break the prop wire.

## Component map

Every `.vue` file in `components/` carries `data-component="ComponentName"` on its root element.

| Component             | Role                                                       |
|-----------------------|------------------------------------------------------------|
| `AnimationEditorView` | Root — hosts both view and edit modes                      |
| `TimeRibbon`          | Zoom/pan ribbon with viewport selector + tick labels       |
| `TimeTicksHeader`     | Standalone tick header (used when the full ribbon isn't)   |
| `TrackList`           | View-mode track list wrapper                               |
| `TrackRow`            | Single view-mode row: checkbox + name + preview canvas     |
| `TrackCanvas`         | Per-track preview canvas inside a `TrackRow`               |
| `Playhead`            | Vertical playhead overlay (used in both modes)             |
| `EditModeView`        | Edit-mode root — sidebar + lanes + precision button + modal|
| `EditSidebar`         | Edit-mode track controls, grouped by field type            |
| `NumberLane`          | Edit-mode Konva lane for number tracks                     |
| `EnumLane`            | Edit-mode Konva lane for enum tracks                       |
| `FuncLane`            | Edit-mode Konva lane for func tracks                       |
| `PrecisionEditor`     | Precision edit modal (teleported into `AnimationEditorView`'s local overlay root) |
| `ToastContainer`      | Bottom-right toast stack                                   |

Reading the ancestry chain: in dev tools, right-click an element → Inspect → walk up the Elements panel tree collecting `data-component` values. That's the file list to open.

## Region reference

Grouped by component.

### `AnimationEditorView`
| Region                  | Description                                                                               |
|-------------------------|-------------------------------------------------------------------------------------------|
| `control-header`        | Top bar — mode toggle + mode-specific controls (search / hide-empty in view, undo / redo in edit) |
| `view-controls`         | The right-aligned group inside `control-header`, visible only when `data-mode="view"`     |
| `edit-controls`         | The right-aligned group inside `control-header`, visible only when `data-mode="edit"`     |
| `editor-body`           | Wrapper below the control header containing `TimeRibbon`, mode content, and the resize handle |
| `overlay-root`          | Empty local mount target for teleported overlays such as `PrecisionEditor`                |
| `track-list-container`  | View-mode scroll container                                                                |

### `TimeRibbon`
| Region                 | Description                                    |
|------------------------|------------------------------------------------|
| `ribbon-viewport-row`  | Outer row containing the draggable viewport   |
| `ribbon-track`         | The ribbon bar itself                          |
| `ribbon-ticks-row`     | The tick labels row below the ribbon          |

### `TrackRow` (view mode)
| Region              | Description                              |
|---------------------|------------------------------------------|
| `track-name-cell`   | Left cell — checkbox + track name        |
| `track-canvas-cell` | Right cell — per-track preview canvas    |

### `EditModeView`
| Region               | Description                                                                            |
|----------------------|----------------------------------------------------------------------------------------|
| `sidebar-column`     | Left sidebar wrapper. Width is driven by the `--sidebar-width` CSS variable             |
| `lanes-area`         | Right area containing lanes and precision button                                       |
| `lanes-container`    | Positioning parent for the three lanes and absolute-positioned overlays (Playhead, precision button). **Not** the scroll parent — vertical scroll lives on `.edit-mode-view`. |
| `lanes-empty-state`  | "Select tracks in view mode to edit" placeholder                                       |

Note: undo/redo used to live here as a `.sidebar-header` strip. They moved to `control-header` inside `AnimationEditorView` and are gated on `data-mode="edit"`.

### `EditSidebar`
| Region                    | Description                                                |
|---------------------------|------------------------------------------------------------|
| `sidebar-number-section`  | Number-tracks section (also `data-track-type="number"`)    |
| `sidebar-enum-section`    | Enum-tracks section (also `data-track-type="enum"`)        |
| `sidebar-func-section`    | Func-tracks section (also `data-track-type="func"`)        |
| `sidebar-bounds-row`      | Low/High bounds inputs (number tracks, front track only)   |
| `sidebar-empty-state`     | "Select tracks in view mode" placeholder                   |

### Lane components (`NumberLane`, `EnumLane`, `FuncLane`)
| Region        | Description                                  |
|---------------|----------------------------------------------|
| `lane-canvas` | The inner div that hosts the Konva stage     |

### `PrecisionEditor`
| Region                          | Description                                                      |
|---------------------------------|------------------------------------------------------------------|
| `precision-modal`               | Backdrop + root (also `data-field-type`, `data-dirty`)           |
| `precision-modal-header`        | Title row with track badge and close button                      |
| `precision-modal-body`          | Scrollable body containing the field rows                        |
| `precision-modal-footer`        | Revert / Save buttons row                                        |
| `precision-field-time`          | Time input row (present for all field types)                     |
| `precision-field-number-value`  | Number value input row (number tracks only)                      |
| `precision-field-enum-value`    | Enum value select row (enum tracks only)                         |
| `precision-field-func-name`     | Function name input row (func tracks only)                       |
| `precision-func-args`           | Arguments subsection (func tracks only)                          |

Note: `PrecisionEditor` is teleported into `AnimationEditorView [data-region="overlay-root"]`, not to `document.body`. That keeps its scoped styles working both in the normal browser app and in the custom-element/shadow-root standalone window.

### `ToastContainer`
| Region            | Description                          |
|-------------------|--------------------------------------|
| `toast-container` | The fixed-position toast stack       |

## Test ID reference

Grouped by flow.

### Control header (all modes)
| Test ID                  | Element                                                                               |
|--------------------------|---------------------------------------------------------------------------------------|
| `mode-toggle`            | View↔Edit mode toggle button                                                          |
| `sidebar-resize-handle`  | The 5px vertical drag handle at the right edge of the sidebar column. Drag to resize. |

### Control header — view-mode only (`data-region="view-controls"`)
| Test ID             | Element                                                                                                  |
|---------------------|----------------------------------------------------------------------------------------------------------|
| `search-input`      | Track search filter input                                                                                |
| `hide-empty-toggle` | "Hide empty tracks" checkbox                                                                             |

### Control header — edit-mode only (`data-region="edit-controls"`)
| Test ID | Element     |
|---------|-------------|
| `undo`  | Undo button |
| `redo`  | Redo button |

### Track list (view mode)
| Test ID          | Element                                                                                                    |
|------------------|------------------------------------------------------------------------------------------------------------|
| `track-checkbox` | Per-track select-for-edit checkbox — disambiguate with `[data-track-id="..."]` on the ancestor `TrackRow`  |

### Time ribbon
| Test ID              | Element                         |
|----------------------|---------------------------------|
| `ribbon-viewport`    | Draggable viewport rectangle    |
| `ribbon-handle-start`| Left resize handle              |
| `ribbon-handle-end`  | Right resize handle             |

### Edit sidebar
| Test ID        | Element                                                                          |
|----------------|----------------------------------------------------------------------------------|
| `track-delete` | Per-track × button — disambiguate with the ancestor `[data-track-id="..."]`      |
| `bounds-low`   | Low bound input (front number track only)                                        |
| `bounds-high`  | High bound input (front number track only)                                       |

### Precision editor
| Test ID                  | Element                                           |
|--------------------------|---------------------------------------------------|
| `precision-open`         | Floating pencil button next to selected element   |
| `precision-save`         | Save button                                       |
| `precision-revert`       | Revert button (disabled when `!data-dirty`)       |
| `precision-close`        | Close (×) button in the modal header              |
| `precision-time`         | Time input (all field types)                      |
| `precision-number-value` | Value input (number tracks)                       |
| `precision-enum-value`   | Value select (enum tracks)                        |
| `precision-func-name`    | Function name input (func tracks)                 |
| `precision-arg-add`      | "+ Add" button in the args section                |
| `precision-arg-type`     | Per-row type select — disambiguate with `[data-arg-index="..."]` |
| `precision-arg-value`    | Per-row value input — disambiguate with `[data-arg-index="..."]` |
| `precision-arg-remove`   | Per-row × remove button — disambiguate with `[data-arg-index="..."]` |

## Identity and state reference

| Attribute             | Where                                                              | Meaning                                                  |
|-----------------------|--------------------------------------------------------------------|----------------------------------------------------------|
| `data-mode`           | `AnimationEditorView` root                                         | `"view"` or `"edit"`                                     |
| `data-track-id`       | `TrackRow`, `TrackCanvas`, sidebar `.track-item`                   | Track id string                                          |
| `data-track-type`     | Same scopes + sidebar section divs + lane roots                    | `"number"`, `"enum"`, or `"func"`                        |
| `data-lane-type`      | Lane component roots (`NumberLane`, `EnumLane`, `FuncLane`)        | `"number"`, `"enum"`, or `"func"` — redundant with `data-component` but simpler to query |
| `data-front-track-id` | Lane component roots                                                | Track id of the current front track for that lane        |
| `data-front`          | Sidebar `.track-item`                                              | Present when this item is the front track for its type   |
| `data-selected`       | View-mode `TrackRow`                                               | Present when checked for editing                         |
| `data-field-type`     | `PrecisionEditor` backdrop                                         | `"number"`, `"enum"`, or `"func"`                        |
| `data-dirty`          | `PrecisionEditor` backdrop                                         | Present when draft differs from saved                    |
| `data-selected-type`  | `precision-open` button                                            | Which lane type the button is currently tracking         |
| `data-toast-type`     | Each toast inside `ToastContainer`                                 | `"info"`, `"warning"`, `"error"`, or `"success"`         |
| `data-arg-index`      | Precision editor arg rows                                          | Numeric index (as string)                                |

## Layout and scroll architecture

Two invariants that design changes must preserve:

1. **Sidebar sections are height-locked to lanes in edit mode.** Each `.track-section` in `EditSidebar` has `height` equal to its matching lane constant (`NUMBER_LANE_HEIGHT=200`, `ENUM_LANE_HEIGHT=120`, `FUNC_LANE_HEIGHT=120`), driven via `v-bind` attribute selectors on `data-track-type`. The `.sidebar-track-list` inside each section has `flex: 1; overflow-y: auto` so extra tracks scroll within the fixed section height. This is what keeps a sidebar section visually aligned with its lane regardless of how many tracks are enabled.
2. **Vertical scroll lives on `.edit-mode-view`, not on `.lanes-container` or `.edit-sidebar`.** With `align-items: flex-start` + `overflow-y: auto` on `.edit-mode-view`, both the sidebar column and the lanes column scroll together as a single unit. Do **not** put `overflow: auto` back on `.lanes-container` or `.edit-sidebar` — it breaks the scroll sync. The precision button and Playhead overlays remain absolutely positioned inside `.lanes-container` (which is still `position: relative`); they scroll with the content as expected.

## Draggable sidebar width

A single `sidebarWidth` ref in `AnimationEditorView` drives the name-column width in view mode, the sidebar-column width in edit mode, and the `TimeRibbon` spacer. It is published to descendants as a CSS custom property:

```html
<div class="animation-editor" :style="{ '--sidebar-width': sidebarWidth + 'px' }">
```

Components that need the current width read `var(--sidebar-width)` in their scoped CSS (see `TrackRow.vue` `.name-cell` and `EditModeView.vue` `.sidebar-column`). `TimeRibbon` receives it explicitly via the `spacer-width` prop since it's the piece that's otherwise reusable outside this hierarchy.

- **Drag**: `data-testid="sidebar-resize-handle"` — a 5px wide `col-resize` overlay inside `.editor-body`, positioned at `left: (sidebarWidth - 2)px`. Pointer-down starts the drag, global mousemove updates the ref, mouseup persists.
- **Clamp**: `[120, 500]` px, additionally capped by the current editor width so at least 180px of timeline remains visible.
- **Persistence**: `localStorage` key `animationEditor.sidebarWidth`. Load at module init, save on `mouseup`.
- **Initial value**: falls back to `NAME_COLUMN_WIDTH` (180) if nothing is stored.

## Canvas caveat — Konva lanes

`NumberLane`, `EnumLane`, and `FuncLane` draw their keyframe markers onto a `<canvas>` via Konva. Those markers are **not in the DOM** — you cannot select them with CSS selectors or `getByTestId`. Only the lane wrapper `<div data-component="NumberLane" ...>` and its inner `<div data-region="lane-canvas">` exist.

To reference a specific keyframe:
- **By state**: read `EditModeView.selectedElementByType` (component state) instead of querying the DOM.
- **By position**: the lane components expose `getSelectedElementPosition()` via `defineExpose` — `EditModeView` uses this to position the floating `precision-open` button.
- **Visually**: for design review, screenshot the lane wrapper and annotate it visually. There is no per-element DOM hook to target.

If you find yourself needing to drive a specific keyframe interaction from an automation script, prefer dispatching an `EditorAction` directly through the `onAction` pipeline in `EditModeView.vue` over trying to simulate a Konva drag.

## Class naming and dedupe

Most scoped CSS classes were left unchanged. One rename was done to avoid ambiguity when pasting HTML snippets across components:

- **`EditSidebar.vue`** originally used `.track-row`, `.track-list`, `.track-name` inside its scoped CSS. `TrackRow.vue` and `TrackList.vue` use the same names. Vue's scoped-style hashing kept them from actually colliding visually, but `document.querySelectorAll('.track-row')` from a non-scoped context matches both. Renamed inside `EditSidebar.vue` to:
  - `.sidebar-track-row`
  - `.sidebar-track-list`
  - `.sidebar-track-name`
- View-mode `TrackRow.vue` and `TrackList.vue` keep their original class names (`.track-row`, `.name-cell`, `.track-name`, `.track-list`).

## Example queries

```js
// Current editor mode
document.querySelector('[data-component="AnimationEditorView"]').dataset.mode
// → "view" or "edit"

// The bounds-low input on a front number track
document.querySelector('[data-component="EditSidebar"] [data-track-type="number"][data-front] [data-testid="bounds-low"]')

// The view-mode checkbox for the 'rotation' track
document.querySelector('[data-component="TrackRow"][data-track-id="rotation"] [data-testid="track-checkbox"]')

// The precision modal when it has unsaved changes
document.querySelector('[data-region="precision-modal"][data-dirty]')

// All tracks currently selected for editing
document.querySelectorAll('[data-component="TrackRow"][data-selected]')

// The enum lane's front-track indicator
document.querySelector('[data-lane-type="enum"]').dataset.frontTrackId

// Current sidebar width (as rendered)
getComputedStyle(
  document.querySelector('[data-component="AnimationEditorView"]')
).getPropertyValue('--sidebar-width')
```

Playwright equivalents (when driving via `dev-browser`):

```ts
await page.getByTestId('mode-toggle').click()
await page.getByTestId('search-input').fill('rotation')
await page.locator('[data-component="TrackRow"][data-track-id="rotation"]')
         .getByTestId('track-checkbox').check()
await page.getByTestId('precision-save').click()
```
