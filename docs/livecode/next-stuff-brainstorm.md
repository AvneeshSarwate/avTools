
how would implementing something like midi-mapping for parameters via the GUI work?
- UI creates a binding that actually gets instantiated and persists in the server? 

how would implementing something like ableton clip-launcher style interface work?
- what's the desired patterns for UIs that would actually launch tasks rather than just write to data stores?

think of how to "bake" a project into something where the engine side can run in the browser (providing it's only using the broser compatibile libs, eg webgpu-graphics + soon-to-be-isomorphic midi). then find a way to set it up using Broadcast Message API so you can open control panel in one tab and engine in another
- design note for this (both baked and remote-dev variants) is in docs/livecode/history/browser-engine-plan-2026-08.md

browser-engine timing hardening: a Worker-backed time source for core-timing - browsers throttle main-thread timers in background tabs, and worker timers escape the clamp. core-timing already takes an injected setTimeout (`opts.setTimeout`), so a dedicated worker that fires deadlines and postMessages back could slot in without touching the scheduler. not needed for v1 (silent AudioContext + keeping the engine tab visible is enough for a single operator), but useful if browser-engine timing ever needs to survive backgrounding