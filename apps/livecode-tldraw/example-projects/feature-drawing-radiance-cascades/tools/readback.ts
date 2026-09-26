/**
 * GPU readback and error metrics shared by the Deno tools.
 */

/** Read an rgba16float texture back as float32 RGBA. */
export async function readback(
  device: GPUDevice,
  texture: GPUTexture,
): Promise<Float32Array> {
  const bytesPerRow = Math.ceil((texture.width * 8) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * texture.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, {
    width: texture.width,
    height: texture.height,
  });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(buffer.getMappedRange());
  const out = new Float32Array(texture.width * texture.height * 4);
  const rowHalves = bytesPerRow / 2;
  for (let y = 0; y < texture.height; y++) {
    for (let i = 0; i < texture.width * 4; i++) {
      out[y * texture.width * 4 + i] = halfToFloat(halves[y * rowHalves + i]);
    }
  }
  buffer.unmap();
  buffer.destroy();
  return out;
}

export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export const tonemap = (x: number) => 1 - 1 / (1 + Math.max(0, x)) ** 2.5;

export const luminance = (rgba: Float32Array, i: number) =>
  0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];

/** RMS of tone-mapped luminance differences between two images. */
export function rmsError(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = a.length / 4;
  for (let i = 0; i < n; i++) {
    const d = tonemap(luminance(a, i)) - tonemap(luminance(b, i));
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}
