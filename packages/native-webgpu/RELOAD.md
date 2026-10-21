# Build, Reload, and Reset

TOPs and CHOPs use a fresh V8 isolate for each activation. Module variables,
user globals, timers, promises, event listeners and frame subscriptions start over.
The worker stays alive; a TOP recreates its Dawn device, renderer and GPU resources.

| Control | Effect |
| --- | --- |
| Automatic Builds | Watches and compiles the selected TypeScript entry. |
| Build Script | Requests a build; it does not override Automatic Reload. |
| Automatic Reload | Defaults on. Activates changed successful source. Turn off to keep the current sketch running while edits build. |
| Reload | Adopts the latest successful available source, even if its bytes are unchanged. |
| Reset | Restarts the active source, leaving a newer available build pending. |

First startup loads available source even with Automatic Reload off. Enabling it
adopts a pending change. An identical rebuild does not restart. Build subscriptions
can be shared, but each operator chooses when to activate independently.

Info DAT rows `reload_state` and `source_identity` show pending requests, selected
and active sources, and available/active content fingerprints (FNV-1a for display;
activation compares complete source bytes, so hash collisions cannot hide edits).
A selected source change is staged behind the toggle. An unreadable new source
never silently reuses the previous entry's bundle as its candidate.

A Reload pulse is accepted on the first cook that observes it, including a TOP
collection-only or busy-worker cook. That cook freezes the latest available
version. Builds finishing after that point cannot change the queued request.
Build, wait for Ready, then Reload to choose a particular completed build. With no
successful source for the selected entry, Reload reports an error and leaves the
running sketch alone. When playback/cooking is paused, `Reload Pending` means the
button has queued a request; it does not imply teardown has already happened.

Restart requests are ordered and never coalesced into ordinary buffered inputs.
Unsubmitted pulse events are delivered with the next accepted frame, including
its new generation if that frame activates a replacement. Events already accepted
by the native CHOP queue remain ordered before later restart requests. Pulses do
not carry data; handlers read that accepted frame's input snapshot.

Compilation errors preserve the running environment. A raw JavaScript file or DAT
has no separate type/compile stage: syntax and setup errors occur during activation.
Once activation begins, the old environment stops first. Failed replacement does
not roll back or automatically retry on every cook. Edit source, Reload, or Reset
to retry. A compatible native last-output buffer may remain visible, but it is not
a running old sketch. CHOP schema changes cannot expose an incompatible old buffer.
Resizing a TOP or changing a CHOP output schema restarts the active source even
with Automatic Reload off; these are structural changes.

Buffered and pre-trigger cooks do not wait for restart. Blocking mode waits for the
accepted request, including initialization. Real-time timers still run without TD
cooks; RAF/TimeContext frame waits still advance only on accepted frame requests.

## Portable timing code

SDK 3 includes the ordinary TimeContext implementation:

```ts
import {launch} from '@avtools/core-timing';
export function animate(state: {x: number}) {
  return launch(async ctx => {
    while (true) { state.x++; await ctx.waitSec(.1); }
  });
}
```

This module can run in Node or a browser with the library's required primitives.
Only the TD entry adapter needs `ChopHost`, `SketchHost`, inputs, outputs, or pulses.
The bundler resolves the actual package source through normal TypeScript aliases
and npm/workspace resolution. It does not rewrite imports to `host.timing`.

`host.timing` remains a compatibility API for existing DAT/JS examples. Its launch
wrappers supervise returned tasks and cancel them during disposal. Normal imports
have ordinary library error handling: attach `task.catch(...)` when you need to
report handled task failures. Unhandled rejections and synchronous callback errors
still reach runtime diagnostics.

`host.onDispose` is bounded synchronous best-effort cleanup, in reverse order.
Native finalizers release resources even if cleanup throws or exceeds its budget.
Do not rely on `finally`, promise continuations, or asynchronous cancellation
handlers completing on full reload; the isolate lifetime is the hard boundary.
Application-level task cancellation is still available during normal execution.

Open [the native example](../../apps/td-projects/native/project.toe) for four TOPs
and four CHOPs sharing a TS project. Each Build page has Automatic Reload; each
Sketch/Script page has Reload and Reset. See the project's README and the
[test fixture scripts](test/restart) for control/lifetime tests and measurements.
