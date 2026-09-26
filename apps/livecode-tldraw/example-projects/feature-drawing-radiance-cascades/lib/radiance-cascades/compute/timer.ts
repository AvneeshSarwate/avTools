/**
 * Per-pass GPU timing through `timestamp-query`: each compute pass gets a
 * begin/end timestamp pair, one resolve per frame, and an asynchronous
 * readback through a small ring of staging buffers. Disabled (all methods
 * no-ops, `timings` null) when the device lacks the feature.
 */

export class GpuTimer {
  readonly enabled: boolean;
  /** Milliseconds per label from the last resolved frame, plus `total`. */
  timings: Record<string, number> | null = null;
  private readonly querySet: GPUQuerySet | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;
  private readonly staging: { buffer: GPUBuffer; busy: boolean }[] = [];
  private labels: string[] = [];
  private pendingLabels: string[] = [];
  private pendingStaging: GPUBuffer | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly maxPasses = 32,
  ) {
    this.enabled = device.features.has("timestamp-query");
    if (!this.enabled) return;
    this.querySet = device.createQuerySet({
      label: "rc-timer",
      type: "timestamp",
      count: maxPasses * 2,
    });
    this.resolveBuffer = device.createBuffer({
      label: "rc-timer-resolve",
      size: maxPasses * 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < 3; i++) {
      this.staging.push({
        buffer: device.createBuffer({
          label: `rc-timer-staging-${i}`,
          size: maxPasses * 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
        busy: false,
      });
    }
  }

  /** Start a frame's list of passes. */
  begin(): void {
    this.labels = [];
  }

  /** Timestamp writes for one pass, or undefined when timing is off/full. */
  writes(label: string): GPUComputePassTimestampWrites | undefined {
    if (!this.querySet || this.labels.length >= this.maxPasses) {
      return undefined;
    }
    const index = this.labels.length;
    this.labels.push(label);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: index * 2,
      endOfPassWriteIndex: index * 2 + 1,
    };
  }

  /** Resolve this frame's queries into a free staging buffer (end of encoder). */
  resolve(encoder: GPUCommandEncoder): void {
    this.pendingStaging = null;
    if (!this.querySet || !this.resolveBuffer || this.labels.length === 0) {
      return;
    }
    const slot = this.staging.find((s) => !s.busy);
    if (!slot) return;
    const count = this.labels.length * 2;
    encoder.resolveQuerySet(this.querySet, 0, count, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(
      this.resolveBuffer,
      0,
      slot.buffer,
      0,
      count * 8,
    );
    slot.busy = true;
    this.pendingStaging = slot.buffer;
    this.pendingLabels = this.labels;
  }

  /** After the submit: read the resolved frame back when it completes. */
  collect(): void {
    const buffer = this.pendingStaging;
    if (!buffer) return;
    this.pendingStaging = null;
    const labels = this.pendingLabels;
    const slot = this.staging.find((s) => s.buffer === buffer)!;
    buffer.mapAsync(GPUMapMode.READ).then(() => {
      const stamps = new BigUint64Array(buffer.getMappedRange());
      const timings: Record<string, number> = {};
      let first = stamps[0];
      let last = stamps[0];
      // Exclusive time per pass: passes run in order, and a begin stamp can
      // predate the previous pass's end (separate submits on Metal do that).
      let previousEnd = stamps[0];
      for (let i = 0; i < labels.length; i++) {
        const begin = stamps[i * 2] > previousEnd ? stamps[i * 2] : previousEnd;
        const end = stamps[i * 2 + 1];
        const ms = end > begin ? Number(end - begin) / 1e6 : 0;
        if (end > previousEnd) previousEnd = end;
        timings[labels[i]] = (timings[labels[i]] ?? 0) + ms;
        if (begin < first) first = begin;
        if (end > last) last = end;
      }
      timings.total = Number(last - first) / 1e6;
      this.timings = timings;
      buffer.unmap();
      slot.busy = false;
    }).catch(() => {
      slot.busy = false;
    });
  }

  dispose(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const slot of this.staging) slot.buffer.destroy();
  }
}
