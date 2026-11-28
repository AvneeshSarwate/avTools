// A growable, CPU-mirrored instance buffer of capsules behind one three.js
// Mesh (an instanced quad). Writers append, or truncate and rewrite the end;
// flush() uploads only the range touched since the last flush (bufferSubData
// via updateRanges). Capacity doubles when exceeded, which re-uploads
// everything once (amortised).
import * as THREE from "three";

// Per capsule (CSS px; a radius < 0 marks "none"):
//   P (x, y, r): the previous capsule's start | A | B: this capsule | N: the
//   next capsule's end | colour at A (rgb) | colour at B (rgb)
export const ISTRIDE = 18;

// Screen-space geometry is never culled; this stops three computing spheres
// from attributes it would misread.
export const UNBOUNDED = new THREE.Sphere(new THREE.Vector3(), Infinity);

// One quad; the shader takes the corner from gl_VertexID (0..3).
const quadIndex = new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);

export class CapsuleBuffer {
  data: Float32Array;
  count = 0;
  readonly mesh: THREE.Mesh;
  private geometry!: THREE.InstancedBufferGeometry;
  private buffer!: THREE.InstancedInterleavedBuffer;
  private dirtyFrom = Infinity; // lowest capsule written since the last flush
  private rebuilt = false;

  constructor(material: THREE.Material, capacity = 1024) {
    this.data = new Float32Array(capacity * ISTRIDE);
    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.frustumCulled = false; // positions are screen px; there is no camera space
    this.rebuildGeometry();
  }

  /** Make room for `n` more capsules past the current count. */
  reserve(n: number) {
    const need = (this.count + n) * ISTRIDE;
    if (need <= this.data.length) return;
    const next = new Float32Array(Math.max(need, this.data.length * 2));
    next.set(this.data.subarray(0, this.count * ISTRIDE));
    this.data = next;
    this.rebuildGeometry();
  }

  mark(from: number) {
    if (from < this.dirtyFrom) this.dirtyFrom = from;
  }

  clear() {
    this.count = 0;
    this.mark(0);
  }

  /** Append another buffer's capsules (a finished stroke joining the shared buffer). */
  append(src: CapsuleBuffer) {
    this.reserve(src.count);
    this.mark(this.count);
    this.data.set(src.data.subarray(0, src.count * ISTRIDE), this.count * ISTRIDE);
    this.count += src.count;
  }

  /** Upload what changed. */
  flush() {
    if (this.rebuilt) {
      this.rebuilt = false; // a fresh GPU buffer uploads its whole array on first use
    } else if (this.dirtyFrom < this.count) {
      this.buffer.addUpdateRange(this.dirtyFrom * ISTRIDE, (this.count - this.dirtyFrom) * ISTRIDE);
      this.buffer.needsUpdate = true;
    }
    this.dirtyFrom = Infinity;
    this.geometry.instanceCount = this.count;
  }

  private rebuildGeometry() {
    this.geometry?.dispose();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(quadIndex);
    const buffer = new THREE.InstancedInterleavedBuffer(this.data, ISTRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("capP", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute("capA", new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute("capB", new THREE.InterleavedBufferAttribute(buffer, 3, 6));
    geometry.setAttribute("capN", new THREE.InterleavedBufferAttribute(buffer, 3, 9));
    geometry.setAttribute("colA", new THREE.InterleavedBufferAttribute(buffer, 3, 12));
    geometry.setAttribute("colB", new THREE.InterleavedBufferAttribute(buffer, 3, 15));
    geometry.instanceCount = this.count;
    geometry.boundingSphere = UNBOUNDED;
    this.geometry = geometry;
    this.buffer = buffer;
    this.mesh.geometry = geometry;
    this.rebuilt = true;
  }
}
