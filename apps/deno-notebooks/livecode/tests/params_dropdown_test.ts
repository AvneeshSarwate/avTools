import { assertEquals } from "jsr:@std/assert@1";
import {
  clearParamsStore,
  getParams,
  registerParams,
  removeParams,
  setParamsValues,
} from "@avtools/livecode-engine/params_store.ts";
Deno.test("dropdown metadata survives snapshots and leaves values ordinary primitives", () => {
  clearParamsStore();
  const options = {
    Off: "off",
    "On (sine)": "on",
    "Random ramp": "random-ramp",
  };
  const live = registerParams("test/modes", { mode: "off" }, {
    mode: { options },
  });
  assertEquals(getParams("test/modes")?.meta, { mode: { options } });
  setParamsValues("test/modes", { mode: "random-ramp" });
  assertEquals(live.mode, "random-ramp");
  assertEquals(getParams("test/modes")?.values?.mode, "random-ramp");
  removeParams("test/modes");
});
