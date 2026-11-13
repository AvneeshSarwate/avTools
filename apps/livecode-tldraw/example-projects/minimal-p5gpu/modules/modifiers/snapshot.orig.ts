import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export default async function (_ctx: TimeContext) {
  state.snapshotRequested = true;
}
