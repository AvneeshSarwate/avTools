// A growable, CPU-mirrored instance buffer of tapered capsules behind one
// three.js Mesh (an instanced quad). Writers append, or truncate and rewrite
// the end; flush() uploads only the range touched since the last flush
// (bufferSubData via updateRanges). Capacity doubles when exceeded, which
// re-uploads everything once (amortised).
import * as THREE from "three";

// Per capsule: ax, ay, ra | bx, by, rb (CSS px) | colour at a (rgb) | colour at b (rgb)
export const ISTRIDE = 12;

// Screen-space geometry is never culled; this stops three computing spheres
// from 2D positions (it reads a missing z as NaN).
export const UNBOUNDED = new THREE.Sphere(new THREE.Vector3(), Infinity);

// The base quad: x picks the end (-1 = behind a, +1 = past b), y the side.
const corners = new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2);
const cornerIndex = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);

export class CapsuleBuffer {
  data: Float32Array;
  count = 0;
  readonly mesh: THREE.Mesh;
  private geometry!: THREE.InstancedBufferGeometry;
  private buffer!: THREE.InstancedInterleavedBuffer;
  private dirtyFrom = Infinity; // lowest instance written since the last flush
  private rebuilt = false;
  // Screen area (CSS px) touched since the last flush: what was truncated
  // away plus what was written, so a redraw can be limited to it.
  readonly rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  // Bounds (CSS px) of everything currently in the buffer, as of the last flush.
  readonly bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  constructor(material: THREE.Material, capacity = 1024) {
    this.data = new Float32Array(capacity * ISTRIDE);
    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.frustumCulled = false; // positions are screen px; there is no camera space
    this.rebuildGeometry();
  }

  get dirty() {
    return this.rebuilt || this.dirtyFrom !== Infinity;
  }

  /** Make room for `n` more instances past the current count. */
  reserve(n: number) {
    const need = (this.count + n) * ISTRIDE;
    if (need <= this.data.length) return;
    const next = new Float32Array(Math.max(need, this.data.length * 2));
    next.set(this.data.subarray(0, this.count * ISTRIDE));
    this.data = next;
    this.rebuildGeometry();
  }

  /** Drop instances from `count` on; the next writes land there. */
  truncate(count: number) {
    if (count < this.count) this.expandRect(count, this.count);
    this.count = count;
    this.mark(count);
  }

  mark(from: number) {
    if (from < this.dirtyFrom) this.dirtyFrom = from;
  }

  clear() {
    this.truncate(0);
    this.resetRect();
  }

  resetRect() {
    const r = this.rect;
    r.x0 = r.y0 = Infinity;
    r.x1 = r.y1 = -Infinity;
  }

  private expandRect(from: number, to: number, r = this.rect) {
    const d = this.data;
    for (let i = from; i < to; i++) {
      const o = i * ISTRIDE;
      for (let e = 0; e < 6; e += 3) {
        const x = d[o + e], y = d[o + e + 1], rad = d[o + e + 2];
        if (x - rad < r.x0) r.x0 = x - rad;
        if (y - rad < r.y0) r.y0 = y - rad;
        if (x + rad > r.x1) r.x1 = x + rad;
        if (y + rad > r.y1) r.y1 = y + rad;
      }
    }
  }

  /** Upload what changed; `rect` then covers what changed on screen. */
  flush() {
    if (!this.dirty) return;
    if (this.dirtyFrom < this.count) this.expandRect(this.dirtyFrom, this.count);
    if (this.rebuilt) {
      this.rebuilt = false; // a fresh GPU buffer uploads its whole array on first use
    } else if (this.dirtyFrom < this.count) {
      this.buffer.addUpdateRange(this.dirtyFrom * ISTRIDE, (this.count - this.dirtyFrom) * ISTRIDE);
      this.buffer.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.geometry.instanceCount = this.count;
    const b = this.bounds;
    b.x0 = b.y0 = Infinity;
    b.x1 = b.y1 = -Infinity;
    this.expandRect(0, this.count, b);
  }

  dispose() {
    this.geometry.dispose();
  }

  private rebuildGeometry() {
    this.geometry?.dispose();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", corners);
    geometry.setIndex(cornerIndex);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, ISTRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("capA", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute("capB", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute("colA", new THREE.InterleavedBufferAttribute(buffer, 3, 6));
    geometry.setAttribute("colB", new THREE.InterleavedBufferAttribute(buffer, 3, 9));
    geometry.instanceCount = this.count;
    geometry.boundingSphere = UNBOUNDED;
    this.geometry = geometry;
    this.buffer = buffer;
    this.mesh.geometry = geometry;
    this.rebuilt = true;
  }
}
