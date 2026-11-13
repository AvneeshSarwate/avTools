/// <reference lib="dom" />

import { P5GPU } from "../tools/p5gpu.ts";
import { createFloodFillGraph } from "../window/mod.ts";
import { requestWebGpuDevice, readTextureToFloatRGBA } from "../libraryIntegrationTetsts/raw-webgpu-helpers.ts";

const WIDTH = 96;
const HEIGHT = 96;

const device = await requestWebGpuDevice();
const p5 = new P5GPU(device, { width: WIDTH, height: HEIGHT });
const floodFill = await createFloodFillGraph(device, {
  width: WIDTH,
  height: HEIGHT,
  preferredFormats: ["rgba16float", "rgba8unorm"],
});

try {
  const counts: number[] = [];

  for (let frame = 0; frame < 6; frame += 1) {
    p5.beginFrame();
    p5.clear();

    if (frame === 0) {
      p5.fill(255, 80, 40, 255);
      p5.noStroke();
      p5.circle(WIDTH / 2, HEIGHT / 2, 12);
    }

    const sourceTexture = p5.endFrame();
    floodFill.setSource(sourceTexture);
    const output = floodFill.render(frame + 1);
    const { floatPixels } = await readTextureToFloatRGBA(
      device,
      output.outputTexture,
      WIDTH,
      HEIGHT,
      floodFill.format,
    );

    let activePixels = 0;
    for (let i = 0; i < floatPixels.length; i += 4) {
      if (floatPixels[i + 3] > 0.5) {
        activePixels += 1;
      }
    }
    counts.push(activePixels);
  }

  console.log(`[p5gpu_flood_fill_smoke] counts=${counts.join(",")}`);

  if (counts[0] <= 0) {
    throw new Error("Flood-fill smoke test never rendered the initial seed");
  }
  if (counts.at(-1)! <= counts[0]) {
    throw new Error(`Flood-fill did not expand: start=${counts[0]} end=${counts.at(-1)!}`);
  }

  console.log("[p5gpu_flood_fill_smoke] success");
} finally {
  floodFill.dispose();
  p5.dispose();
}
