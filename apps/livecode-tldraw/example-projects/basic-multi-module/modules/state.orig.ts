import type { TimeContext } from "@avtools/core-timing";

export interface CounterState {
  count: number;
  lastUpdatedBy: string;
}

export const state: CounterState = {
  count: 0,
  lastUpdatedBy: "initial state",
};

export default async function (_ctx: TimeContext) {
  // Shared-data modules still use the same runnable module contract.
}
