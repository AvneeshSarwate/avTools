/// <reference lib="dom" />

import { createGpuWindow, createWindowTweakpane } from "../window/mod.ts";

const WIDTH = 640;
const HEIGHT = 360;
const READY_TIMEOUT_MS = Number(Deno.env.get("P5_TWEAKPANE_TIMEOUT_MS") ?? 8000);
const EXPECTED_BINDINGS = 5;
const EXPECTED_MIN_SLIDER_WIDTH = 120;
const EXPECTED_MIN_VIEWPORT_WIDTH = 430;
const AUTOCHECK_SPEED_VALUE = 6.4;

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No WebGPU adapter");
const device = await adapter.requestDevice();

const win = await createGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "Tweakpane Smoke",
});

try {
  const params = {
    speed: 2.0,
    radius: 200,
    count: 12,
    hue: 180,
    bgAlpha: 20,
  };

  const pane = createWindowTweakpane(win, {
    title: "Circle Demo",
    panelWidth: 420,
    panelHeight: 680,
  });

  pane.addBinding(params, "speed", { min: 0.1, max: 10, step: 0.1 });
  pane.addBinding(params, "radius", { min: 50, max: 400, step: 1 });
  pane.addBinding(params, "count", { min: 3, max: 36, step: 1 });
  pane.addBinding(params, "hue", { min: 0, max: 360, step: 1 });
  pane.addBinding(params, "bgAlpha", { min: 0, max: 255, step: 1 });

  let initialSliderTrackWidth = 0;
  let inputInjected = false;
  let inputRoundtripVerified = false;
  let resizeVerified = false;
  let readyLogged = false;
  const readyDeadline = performance.now() + READY_TIMEOUT_MS;

  while (!win.closed) {
    const events = win.pollEvents();
    if (events.some((event) => event.type === "close")) {
      break;
    }

    if (pane.lastError) {
      throw new Error(`Tweakpane panel error [${pane.lastError.stage}]: ${pane.lastError.message}`);
    }

    if (pane.readyInfo) {
      const ready = pane.readyInfo;
      if (ready.bindingCount !== EXPECTED_BINDINGS) {
        throw new Error(
          `Unexpected tweakpane binding count: expected ${EXPECTED_BINDINGS}, got ${ready.bindingCount}`,
        );
      }
      if (ready.title !== "Circle Demo") {
        throw new Error(`Unexpected tweakpane title: ${String(ready.title)}`);
      }
      if ((ready.sliderTrackWidth ?? 0) < EXPECTED_MIN_SLIDER_WIDTH) {
        throw new Error(
          `Slider track is too narrow: expected at least ${EXPECTED_MIN_SLIDER_WIDTH}px, got ${ready.sliderTrackWidth ?? 0}px`,
        );
      }

      if (!readyLogged) {
        console.log(
          `[tweakpane_panel_smoke] ready title=${ready.title} bindings=${ready.bindingCount} operations=${ready.operationCount} sliders=${ready.sliderCount ?? 0} textInputs=${ready.textInputCount ?? 0} buttons=${ready.buttonCount ?? 0} sliderTrackWidth=${ready.sliderTrackWidth ?? 0} sliderKnobWidth=${ready.sliderKnobWidth ?? 0}`,
        );
        readyLogged = true;
      }

      if (!initialSliderTrackWidth) {
        initialSliderTrackWidth = ready.sliderTrackWidth ?? 0;
      }

      if (!inputInjected) {
        pane.setPanelSize(480, 720);
        pane.evalPanelJs(`
(() => {
  const input = document.querySelector('.tp-sldtxtv .tp-txtv_i');
  if (!(input instanceof HTMLInputElement)) {
    window.ipc.postMessage(JSON.stringify({
      type: 'panelError',
      stage: 'autocheck.inputProbe',
      message: 'Could not find numeric tweakpane input',
    }));
    return;
  }
  input.focus();
  input.value = '${AUTOCHECK_SPEED_VALUE.toFixed(1)}';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.blur();
  window.ipc.postMessage(JSON.stringify({
    type: 'panelMetrics',
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    sliderTrackWidth: document.querySelector('.tp-sldv_t')?.getBoundingClientRect().width ?? 0,
    sliderKnobWidth: document.querySelector('.tp-sldv_k')?.getBoundingClientRect().width ?? 0,
  }));
})();
        `);
        inputInjected = true;
      }
    }

    if (
      pane.panelMetrics &&
      pane.panelMetrics.viewportWidth >= EXPECTED_MIN_VIEWPORT_WIDTH &&
      pane.panelMetrics.sliderTrackWidth > initialSliderTrackWidth
    ) {
      resizeVerified = true;
    }

    if (inputInjected && Math.abs(params.speed - AUTOCHECK_SPEED_VALUE) < 0.001) {
      if (!inputRoundtripVerified) {
        console.log(`[tweakpane_panel_smoke] input roundtrip success speed=${params.speed.toFixed(1)}`);
      }
      inputRoundtripVerified = true;
    }

    if (inputRoundtripVerified && resizeVerified) {
      if (pane.panelMetrics) {
        console.log(
          `[tweakpane_panel_smoke] resize sync success viewport=${pane.panelMetrics.viewportWidth}x${pane.panelMetrics.viewportHeight} sliderTrackWidth=${pane.panelMetrics.sliderTrackWidth}`,
        );
      }
      console.log("[tweakpane_panel_smoke] success");
      break;
    }

    if (performance.now() > readyDeadline) {
      throw new Error(`Timed out after ${READY_TIMEOUT_MS}ms waiting for tweakpane smoke checks`);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!pane.readyInfo) {
    throw new Error("Smoke test ended before tweakpane reported readiness");
  }
  if (!inputRoundtripVerified) {
    throw new Error("Smoke test ended before numeric control roundtrip completed");
  }
  if (!resizeVerified) {
    throw new Error("Smoke test ended before resized panel viewport metrics were observed");
  }
} finally {
  win.close();
}
