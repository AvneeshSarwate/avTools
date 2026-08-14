# Runtime brainstorm source note

> Raw idea source preserved as written. This is neither a current contract nor
> a curated principle. See `docs/livecode/principles/README.md`.

- add an event-bus system so you can send events and handle them from different cells
- define 2 functions, run and stop, and stop gets called when you stop the cell - can use it to do things like teardown of event handlers 
- add hod-reload from file-system so coding agents can read/write the files naturally
- maybe add visualization for event handling? can add more and more different types of useful runtime visualization, doesn't have to be source-code based visualization
  - for example, for event handler, can have a persistent little timeline view that shows a tick scrolling by when handler fires
  - can maybe even vibe code up modular custom "live monitors" for specific musical processes idiosyncratic to different pieces - they're all just tldraw components at the end of the day (extending the idea that the idiosyncratic alg/process IS part of the piece identity)
- figuring out how to do variables + conditional "dry run" visualization would still be cool, but maybe less necessary (or tractable) with this new workflow - execution is way more dynamic, so fun is in the tinkering, and getting a clean "dry run" is a lot harder
- double check whether branching with seeded RNG is actuall deterministic - wouldn't necesarily make dry runs more feasible, but is good to know
