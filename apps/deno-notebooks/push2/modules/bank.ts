import type { Push2 } from "../push2.ts";
import { padIJToN, COLOR } from "../constants.ts";

export interface BankColors {
  empty: number;
  filled: number;
  active: number;
}

const DEFAULT_COLORS: BankColors = {
  empty: COLOR.BLACK,
  filled: COLOR.DARK_GRAY,
  active: COLOR.WHITE,
};

export class BankModule<T> {
  private push: Push2;
  private rows: [number, number];
  private colors: BankColors;
  private visible = false;
  private unsubs: (() => void)[] = [];

  private saveFn: (index: number) => T | null;
  private loadFn: (item: T) => void;
  private slots: (T | null)[];
  private convertHeld = false;

  constructor(
    push: Push2,
    saveFn: (index: number) => T | null,
    loadFn: (item: T) => void,
    options?: {
      rows?: [number, number];
      colors?: Partial<BankColors>;
    },
  ) {
    this.push = push;
    this.saveFn = saveFn;
    this.loadFn = loadFn;
    this.rows = options?.rows ?? [0, 0];
    this.colors = { ...DEFAULT_COLORS, ...options?.colors };

    const numRows = this.rows[1] - this.rows[0] + 1;
    this.slots = new Array(numRows * 8).fill(null);
  }

  activate(): void {
    this.visible = true;
    this.unsubs = [
      this.push.onButtonPressed("Convert", () => {
        this.convertHeld = true;
      }),
      this.push.onButtonReleased("Convert", () => {
        this.convertHeld = false;
      }),

      this.push.onPadPressed((_padN, [i, j]) => {
        if (i < this.rows[0] || i > this.rows[1]) return;

        const slotIdx = (i - this.rows[0]) * 8 + j;

        if (this.convertHeld) {
          const item = this.saveFn(slotIdx);
          if (item !== null) {
            this.slots[slotIdx] = item;
            this.updateLightForSlot(slotIdx, i, j);
          }
        } else {
          const item = this.slots[slotIdx];
          if (item !== null) {
            this.loadFn(item);
            // Momentary flash
            this.push.setPadColor(padIJToN(i, j), this.colors.active);
          }
        }
      }),

      this.push.onPadReleased((_padN, [i, j]) => {
        if (i < this.rows[0] || i > this.rows[1]) return;
        const slotIdx = (i - this.rows[0]) * 8 + j;
        this.updateLightForSlot(slotIdx, i, j);
      }),
    ];
    this.updateLights();
  }

  deactivate(): void {
    this.visible = false;
    this.unsubs.forEach((fn) => fn());
    this.unsubs = [];
    this.clearPads();
  }

  updateLights(): void {
    if (!this.visible) return;
    let slotIdx = 0;
    for (let i = this.rows[0]; i <= this.rows[1]; i++) {
      for (let j = 0; j < 8; j++) {
        this.updateLightForSlot(slotIdx, i, j);
        slotIdx++;
      }
    }
  }

  getSlot(index: number): T | null {
    return this.slots[index] ?? null;
  }

  setSlot(index: number, item: T | null): void {
    this.slots[index] = item;
    if (this.visible) {
      const numCols = 8;
      const row = this.rows[0] + Math.floor(index / numCols);
      const col = index % numCols;
      this.updateLightForSlot(index, row, col);
    }
  }

  private updateLightForSlot(slotIdx: number, i: number, j: number): void {
    const color = this.slots[slotIdx] !== null ? this.colors.filled : this.colors.empty;
    this.push.setPadColor(padIJToN(i, j), color);
  }

  private clearPads(): void {
    for (let i = this.rows[0]; i <= this.rows[1]; i++) {
      for (let j = 0; j < 8; j++) {
        this.push.setPadColor(padIJToN(i, j), COLOR.BLACK);
      }
    }
  }
}
