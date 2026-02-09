/// <reference lib="dom" />

import { createSyphonGpuWindow } from "../syphon/syphon.ts";

const WIDTH = 256;
const HEIGHT = 256;
const FRAMES = 300;
const SERVER_NAME = "Deno Syphon Test";

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
  title: "syphon-server-process",
  syphon: {
    serverName: SERVER_NAME,
  },
});
const syphonServer = window.syphon;

try {
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const events = window.pollEvents();
    for (const event of events) {
      if (event.type === "close") {
        throw new Error("Window closed unexpectedly.");
      }
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
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
} finally {
  window.close();
}

console.log("Syphon server process completed");
