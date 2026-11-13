import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export async function runFunc (_ctx: TimeContext) {
  state.snapshotRequested = true;
}

export default runFunc;
