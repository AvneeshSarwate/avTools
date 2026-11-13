# window render manager + tweakpane — dense reference

Source: `../window/window_render_manager.ts`, `../window/tweakpane_panel.ts`. Wraps a native wry webview window + WebGPU swap chain + optional Syphon publisher + a tweakpane control panel.

## requestWebGpuDevice

```ts
const device = await requestWebGpuDevice();
```
Gets an adapter and requests a device. Throws if no adapter. Not unique to the renderer — reuse `device` across p5gpu and shader-fx.

## createWindowRenderManager

```ts
const renderWindow = await createWindowRenderManager({
  device: GPUDevice,
  width: number,
  height: number,
  title?: string,
  syphon?: {
    serverName: string,       // identifier for downstream Syphon consumers
    flipY?: boolean,
  },
  pane?: {
    title?: string,
    panelWidth?: number,
    panelHeight?: number,
    toggleKey?: string,        // keyboard key to show/hide the panel
    setup?: (pane: WindowTweakpane) => void,
  },
});
```

Returns:
```ts
interface WindowRenderManager {
  device: GPUDevice;
  window: GpuWindow (with optional .syphon);
  pane: WindowTweakpane | null;
  run(frame, options?): Promise<void>;
  present(source): void;
  stop(): void;
  dispose(): void;
}
```

## run — the main loop

```ts
await renderWindow.run(renderFrame, {
  onEvent?: (event, context) => void,
  yieldMs?: number,            // setTimeout yield between frames (default 0)
  cleanup?: () => void,         // runs before dispose
});
```

`renderFrame()` must return a `WindowRenderSource = GPUTexture | GPUTextureView | ShaderEffect`. The manager blits that into the swap chain, publishes via Syphon if configured, and presents.

## Frame callback pattern

```ts
function renderFrame() {
  p5.beginFrame();
  drawScene();
  const tex = p5.endFrame();
  chain.entry.setSrcs({ src: tex });
  chain.terminal.renderAll();
  return chain.terminal;       // ShaderEffect is fine — manager reads .output
}
```

## Tweakpane — never built directly

In plorkSketch, tweakpane population is done by `paramSystem.setupPane(pane)` inside `pane.setup`. Don't manually call `pane.addBinding(...)` / `pane.addFolder(...)` unless you're adding controls *outside* the param system (e.g., debug-only buttons).

Raw API if you must (from `tweakpaneServer.ts`):
```ts
pane.addFolder({ title }): PaneFolder;
pane.addBinding(obj, key, { min?, max?, step?, options?, label? }): PaneBinding;
pane.addButton({ title }): PaneButton;
folder.addBinding(...); folder.addFolder(...); folder.addButton(...);
button.on("click", () => {...});
binding.refresh();       // re-read the bound object's value into the UI
```

Objects passed to `addBinding` are watched for mutations and pushed to the UI on `refresh()`. The underlying tweakpane runs in the webview; `server.processMessages` shuttles changes back via WebSocket.

## Syphon publishing

If `syphon` is configured, each rendered frame is also published to a Syphon server (macOS). Downstream consumers (Resolume, TouchDesigner, etc.) can subscribe to `serverName`. `flipY: true` is typical because Syphon uses GL Y-up. No sketch-side code changes needed — just pass the option.

## Cleanup

The `cleanup` callback runs before `dispose()`. Typical cleanup:
```ts
function cleanup() {
  rootAnim.cancel();
  animationHandle.disconnect();
  animationBridge.shutdown();
  chain.terminal.disposeAll();
  chain.extras?.forEach(e => e.dispose());   // anything outside the DAG
  p5.dispose();
}
```

## Gotchas

- `renderWindow.run` **awaits the main loop** — top-level `await` it as the last statement in the sketch. Code after it runs only after window close.
- `renderFrame` is called synchronously each loop iteration — don't await inside it. Any long work must be scheduled via `core-timing` branches.
- If `window.closed` becomes true, `run` exits, `cleanup` fires, then `dispose` closes the window handle.
- `yieldMs` defaults to 0 — the loop will run as fast as WebGPU allows (typically vsync-limited by the compositor). If you need lower CPU, bump to e.g. 16.
- `pane.setup` is called once; to re-populate after paramDefs change, you'd have to recreate the window. The sketch never needs this — paramDefs are `const`.
