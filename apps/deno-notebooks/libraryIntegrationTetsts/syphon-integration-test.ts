/// <reference lib="dom" />

import { createSyphonGpuWindow } from "../syphon/syphon.ts";

const TARGET_FRAMES = 30;
const WIDTH = 256;
const HEIGHT = 256;

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    Deno.exit(1);
  }
}

const adapter = await navigator.gpu.requestAdapter();
assert(!!adapter, "No WebGPU adapter available.");
const device = await adapter.requestDevice();

const window = await createSyphonGpuWindow(device, {
  width: WIDTH,
  height: HEIGHT,
  title: "syphon-integration-test",
  syphon: {
    serverName: "Deno Syphon Test",
  },
});
const syphonServer = window.syphon;

try {
  for (let frame = 0; frame < TARGET_FRAMES; frame += 1) {
    const events = window.pollEvents();
    for (const event of events) {
      assert(event.type !== "close", "Window closed unexpectedly during test.");
    }

    const texture = window.ctx.getCurrentTexture();
    const view = texture.createView();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.end();

    device.queue.submit([encoder.finish()]);
    syphonServer.publishFrame();
    window.present();

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const intercepts = syphonServer.interceptCount;
  assert(
    intercepts >= BigInt(TARGET_FRAMES),
    `Expected >= ${TARGET_FRAMES} intercepted drawables, got ${intercepts}`,
  );

  assert(
    syphonServer.serverReady,
    "Syphon server did not become ready after publishing frames.",
  );

  const size = syphonServer.lastTextureSize;
  assert(
    size.width > 0 && size.height > 0,
    `Expected non-zero published texture size, got ${size.width}x${size.height}`,
  );

  console.log("ALL INTEGRATION TESTS PASSED");
} finally {
  window.close();
}
