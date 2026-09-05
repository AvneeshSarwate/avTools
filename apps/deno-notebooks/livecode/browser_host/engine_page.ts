/// <reference lib="dom" />
// The standalone browser engine page (`/engine/`, engine.html): one embedder of
// `startBrowserEngineHost` (browser_engine_host.ts owns the engine lifecycle,
// the transports, the lock, MIDI, and the throttling defenses). This file only
// renders the host's status into the page's own chrome lines.
//
// `#livecode-stage` (declared in engine.html) belongs to user modules —
// graphics modules append canvases there — so status rendering only ever
// touches the two status lines below, never the body.

import { startBrowserEngineHost } from "./browser_engine_host.ts";

function pageLine(className: string): HTMLDivElement | null {
  const body = document.body;
  if (!body) return null;
  let line = body.querySelector<HTMLDivElement>(`:scope > .${className}`);
  if (!line) {
    line = document.createElement("div");
    line.className = className;
    body.appendChild(line);
  }
  return line;
}

const host = startBrowserEngineHost({
  engineBaseUrl: new URL("./", location.href).href,
  onStatus: (status) => {
    const line = pageLine("livecode-engine-status");
    if (line) {
      line.textContent = status.message;
      if (status.lock === "blocked") {
        const button = document.createElement("button");
        button.className = "livecode-engine-takeover";
        button.type = "button";
        button.textContent = "Take over as engine";
        button.onclick = () => host.takeover();
        line.appendChild(button);
      }
    }
    const midi = pageLine("livecode-midi-status");
    if (midi && status.midi !== null) midi.textContent = status.midi;
  },
});
