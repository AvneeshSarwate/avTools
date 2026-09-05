import { P5GPU } from "../tools/p5gpu.ts";
import { openLibrary, type Push2DisplayLibrary } from "./ffi.ts";

const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 160;
const RGBA_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 4;

export class Push2Display {
  private lib: Push2DisplayLibrary;
  private state: Deno.PointerValue;
  readonly p5: P5GPU;
  private device: GPUDevice;

  private readbackBuffers: [GPUBuffer, GPUBuffer];
  private readbackIndex: number = 0;
  private mapReady: boolean = false;
  private rgbaStaging: Uint8Array<ArrayBuffer>;

  private drawFn: (p5: P5GPU) => void;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private constructor(
    device: GPUDevice,
    p5: P5GPU,
    lib: Push2DisplayLibrary,
    state: Deno.PointerValue,
    drawFn: (p5: P5GPU) => void,
  ) {
    this.device = device;
    this.p5 = p5;
    this.lib = lib;
    this.state = state;
    this.drawFn = drawFn;
    this.rgbaStaging = new Uint8Array(RGBA_FRAME_BYTES);

    // Readback buffer bytesPerRow must be aligned to 256
    const bytesPerRow = DISPLAY_WIDTH * 4; // 3840, already 256-aligned
    const bufSize = bytesPerRow * DISPLAY_HEIGHT;

    this.readbackBuffers = [
      device.createBuffer({
        size: bufSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      device.createBuffer({
        size: bufSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    ];
  }

  static async create(
    drawFn: (p5: P5GPU) => void,
    options: { fps?: number; displayLibPath?: string } = {},
  ): Promise<Push2Display> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No GPU adapter found");
    const device = await adapter.requestDevice();

    const p5 = new P5GPU(device, {
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      format: "rgba8unorm",
    });

    const lib = openLibrary(options.displayLibPath);
    const state = lib.symbols.push2_display_open();
    if (state === null) {
      lib.close();
      throw new Error("Failed to open Push 2 display (USB device not found?)");
    }

    const display = new Push2Display(device, p5, lib, state, drawFn);
    display.start(options.fps ?? 20);
    return display;
  }

  private start(fps: number) {
    const intervalMs = Math.floor(1000 / fps);
    // Kick off first frame
    this.renderAndSubmitReadback();
    this.intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick() {
    if (!this.mapReady) return; // previous readback still in flight

    // Consume the mapped buffer
    const prevIdx = (this.readbackIndex + 1) % 2;
    const buf = this.readbackBuffers[prevIdx];
    const mapped = new Uint8Array(buf.getMappedRange());
    this.rgbaStaging.set(mapped);
    buf.unmap();
    this.mapReady = false;

    // Send to USB display
    this.lib.symbols.push2_display_send_rgba_frame(
      this.state,
      this.rgbaStaging,
      DISPLAY_WIDTH,
      DISPLAY_HEIGHT,
    );

    // Render next frame and submit readback
    this.renderAndSubmitReadback();
  }

  private renderAndSubmitReadback() {
    // Call user's draw function then flush
    this.drawFn(this.p5);
    this.p5.endFrame();

    // Copy texture to readback buffer
    const buf = this.readbackBuffers[this.readbackIndex];
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.p5.outputTexture },
      { buffer: buf, bytesPerRow: DISPLAY_WIDTH * 4 },
      { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
    );
    this.device.queue.submit([encoder.finish()]);

    // Start mapping (fire-and-forget)
    buf.mapAsync(GPUMapMode.READ).then(() => {
      this.mapReady = true;
    });

    // Flip buffer index
    this.readbackIndex = (this.readbackIndex + 1) % 2;
  }

  close() {
    this.stop();
    this.lib.symbols.push2_display_close(this.state);
    this.readbackBuffers.forEach((b) => b.destroy());
    this.p5.dispose();
    this.device.destroy();
    this.lib.close();
  }
}
