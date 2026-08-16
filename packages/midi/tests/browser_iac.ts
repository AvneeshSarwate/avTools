/// <reference lib="dom" />

import { openMidiAccess } from "../mod.ts";
import { selectLoopbackPort } from "./iac_test_helpers.ts";

const button = document.querySelector<HTMLButtonElement>("#run")!;
const result = document.querySelector<HTMLPreElement>("#result")!;

button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "requesting MIDI access";
  try {
    const midi = await openMidiAccess();
    if (midi.backend !== "browser") {
      throw new Error(
        `Expected automatic browser backend, got ${midi.backend}`,
      );
    }
    const requested = new URL(location.href).searchParams.get("output") ??
      "IAC Driver Bus 1";
    const port = selectLoopbackPort(midi.listOutputs(), requested);
    const output = await midi.openOutput(port.id);
    output.noteOn(0, 61, 102);
    await new Promise((resolve) => setTimeout(resolve, 100));
    output.noteOff(0, 61, 46);
    result.textContent = JSON.stringify(
      {
        ok: true,
        backend: midi.backend,
        output: port,
      },
      null,
      2,
    );
    output.close();
    midi.close();
  } catch (error) {
    result.textContent = JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  } finally {
    button.disabled = false;
  }
});
