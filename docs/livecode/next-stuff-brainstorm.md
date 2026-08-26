
need some kind of library/viewer for seeing entites that have been programatically created but don't have a UI on the canvas yet (or a browse view to just scroll through or something)

for engine running in the browser with graphics libs, are there any tests for that wrt assigning canvases and outputs? probably need some extra "engine side UI" for when things run in the browser
- probably want at least full-screen popout wrapper for canvases, think of other things
- figure out a way for WYSIWYG editting on engine tab (eg, drawing) to send data back to UI? (is it any harder than just writing it to stores?)

figure out how to do typed arbitrary stores for inter-module state so you don't need to directly import from state modules (or find some way to visualize dependency)

figure out a way to make it easier to import 3rd party libraries into project modules

is there a need to add a system for events/handlers or pubsub between modules, or does it naturally fall out without need for extra structure (probably doesn't need a new thing?) 

need some visualized notion of order in the canvas - it does exist and is pretty important? but is it actually true that nothing "fully breaks" if you run things out of order (eg, only module crashes) - should order be manual annotation in the UI? if you run headlessly, you probably need some proper startup order

how would implementing something like midi-mapping for parameters via the GUI work?
- UI creates a binding that actually gets instantiated and persists in the server? 

how would implementing something like ableton clip-launcher style interface work?
- what's the desired patterns for UIs that would actually launch tasks rather than just write to data stores?

think of how to "bake" a project into something where the engine side can run in the browser (providing it's only using the broser compatibile libs, eg webgpu-graphics + soon-to-be-isomorphic midi). then find a way to set it up using Broadcast Message API so you can open control panel in one tab and engine in another
- design note for this (both baked and remote-dev variants) is in docs/livecode/history/browser-engine-plan-2026-08.md

browser-engine timing hardening: a Worker-backed time source for core-timing - browsers throttle main-thread timers in background tabs, and worker timers escape the clamp. core-timing already takes an injected setTimeout (`opts.setTimeout`), so a dedicated worker that fires deadlines and postMessages back could slot in without touching the scheduler. not needed for v1 (silent AudioContext + keeping the engine tab visible is enough for a single operator), but useful if browser-engine timing ever needs to survive backgrounding



small things
- should browser component internal canvas also stretch to fit tldraw shape component like animation editor?
- should UI state like scroll/zoom of piano roll and animation editor get persisted to doc?