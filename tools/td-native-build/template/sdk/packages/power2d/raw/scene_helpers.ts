/// <reference lib="dom" />

import type { Power2DRenderable, Power2DScene } from './types.ts';

export interface Power2DSceneOptions {
  device: GPUDevice;
  width: number;
  height: number;
  format?: GPUTextureFormat;
  clearColor?: GPUColor;
}

async function supportsFormat(device: GPUDevice, format: GPUTextureFormat): Promise<boolean> {
  device.pushErrorScope('validation');
  let texture: GPUTexture | null = null;
  try {
    texture = device.createTexture({
      size: { width: 1, height: 1 },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  } catch {
    await device.popErrorScope();
    return false;
  }
  const error = await device.popErrorScope();
  if (error) {
    return false;
  }
  texture?.destroy();
  return true;
}

export async function selectPower2DFormat(
  device: GPUDevice,
  preferred: GPUTextureFormat[] = ['rgba16float', 'rgba32float', 'rgba8unorm'],
): Promise<GPUTextureFormat> {
  for (const format of preferred) {
    if (await supportsFormat(device, format)) {
      return format;
    }
  }
  return 'rgba8unorm';
}

function createOutputTexture(device: GPUDevice, width: number, height: number, format: GPUTextureFormat): GPUTexture {
  return device.createTexture({
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
}

export function createPower2DScene(options: Power2DSceneOptions): Power2DScene {
  const device = options.device;
  let width = options.width;
  let height = options.height;
  const format = options.format ?? 'rgba16float';
  const clearColor: GPUColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };

  let outputTexture = createOutputTexture(device, width, height, format);
  let outputView = outputTexture.createView();

  const shapes = new Set<Power2DRenderable>();

  const scene: Power2DScene = {
    device,
    format,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    outputTexture,
    outputView,
    addShape(shape: Power2DRenderable): void {
      shapes.add(shape);
    },
    removeShape(shape: Power2DRenderable): void {
      shapes.delete(shape);
    },
    render(): GPUTextureView {
      const encoder = device.createCommandEncoder();
      const ordered = Array.from(shapes).sort((a, b) => a.alphaIndex - b.alphaIndex);
      for (const shape of ordered) {
        shape.beforeRender?.();
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: outputView,
            clearValue: clearColor,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      for (const shape of ordered) {
        shape.render(pass);
      }

      pass.end();
      device.queue.submit([encoder.finish()]);

      return outputView;
    },
    resize(nextWidth: number, nextHeight: number): void {
      if (nextWidth === width && nextHeight === height) {
        return;
      }
      width = nextWidth;
      height = nextHeight;
      outputTexture.destroy();
      outputTexture = createOutputTexture(device, width, height, format);
      outputView = outputTexture.createView();
      scene.outputTexture = outputTexture;
      scene.outputView = outputView;
    },
  };

  return scene;
}
