# Global event buttons

Open this project from `/projects.html`, then Run the panel module. The parameter
pane shows ordinary inferred values and two momentary `play` buttons. Each button
sends `{type: "trigger", body: {melody, state: "down" | "up"}}` to the global
engine registry. Hold with mouse, touch, Space, or Enter; the counters and `held`
value show delivery. Both buttons reach the same listener without entity routing.

The same fixture works with the Deno and browser engines. `canvas-events` shares
the engine's singleton. `events.onEvent(handler)` in a directly recognized timed
scope gets its context from the analyzer; plain/headless code or an unrecognized
helper passes it explicitly as `events.onEvent(handler, ctx)`. The returned
function unsubscribes. Ending/cancelling the context removes its subscriptions;
Stop, Replace, and Panic must not leave old handlers behind. Keep a listener module
running while it should receive input.

Buttons are static metadata and persist with explicit Save project; reopening
restores controls before Run. Events and subscriptions are never saved or replayed.
A duplicated entity retains the literal message payload, including the original
melody name: duplication does not rewrite project-defined routing data.

Check: press/release, release outside the button, hold Space/Enter (including key
repeat), switch focus while held, then Replace and press again (one increment).
Stop and press: no handler runs. A disconnected transport can lose events; there
is no delivery replay or guaranteed release after abrupt tab/network loss. Use
Panic for recovery. The button's `state` field is reserved; body data must be a
JSON object. Arbitrary global events may carry other JSON body types.

Automated UI coverage: `LIVECODE_E2E_CASE=events npm run test:e2e` from
`apps/livecode-tldraw`. Engine/type/lifecycle coverage: `events_test.ts` and the
event case in `analyzer_transform_test.ts`.
