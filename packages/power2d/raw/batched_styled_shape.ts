/// <reference lib="dom" />

import type { BatchMaterialDef, BatchInstanceAttrs } from './types.ts';

interface BatchedStyledShapeOptions<M extends BatchMaterialDef<object, string, Record<string, unknown>>> {
  scene: unknown;
  points: readonly [number, number][];
  material: M;
  instanceCount: number;
  closed?: boolean;
}

export class BatchedStyledShape<M extends BatchMaterialDef<object, string, Record<string, unknown>>> {
  constructor(_options: BatchedStyledShapeOptions<M>) {
    throw new Error('BatchedStyledShape (raw) is not implemented yet.');
  }

  writeInstanceAttr(_index: number, _values: Partial<BatchInstanceAttrs<M>>): void {
    throw new Error('BatchedStyledShape (raw) is not implemented yet.');
  }

  updateInstanceBuffer(): void {
    throw new Error('BatchedStyledShape (raw) is not implemented yet.');
  }

  dispose(): void {
    // no-op
  }
}
