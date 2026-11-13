# Architecture questions

Status: decided; moved to history on 2026-08-14. The token/store direction won:
`docs/livecode/principles.md` adopts "imports carry types and stable tokens;
stores carry live values," and the named-entity tier (piano rolls, params,
signals) implements it — with one synthesis this file's two-column debate did
not anticipate: declarations return a live object or handle for
plain-assignment ergonomics while the store owns identity and lifetime by name.
The generic store for arbitrary module-shared values remains unbuilt; project
modules still share mutable values through Deno's import cache (see the
dependency-reload entry in `current/known-risks.md`). The discussion below is
the preserved rationale.

## Should imports carry live values or types and tokens?

The two ideas describe different answers to: “Where does live state actually live?”

| | Direct shared-value imports | Token/store model |
|---|---|---|
| Module imports | The live object itself | Its type and stable identity |
| Value ownership | Deno’s module instance/cache | A process-global store |
| Identity | JavaScript object/module identity | Serializable string key |
| Reload behavior | Entangled with Deno import caching | Code can reload without replacing state |
| UI/agent access | Requires module-specific access | Uses the same store actions as code |
| Observation/history | Must be added around each object | Natural place for subscriptions, undo, logs |

## Earlier model: imports carry live values

The original p5gpu shape is essentially:

```ts
// state.ts
export const state = {
  speed: 1,
  color: [255, 0, 0],
};
```

```ts
// sketch.ts
import { state } from "./state.ts";

while (true) {
  render(state.color);
  await ctx.waitFrame();
}
```

```ts
// modifier.ts
import { state } from "./state.ts";

export default async function () {
  state.color = [0, 255, 0];
}
```

This is attractive because it is plain TypeScript:

- no framework API;
- excellent type inference;
- the module import expresses the connection;
- both consumers normally receive the same cached `state` object;
- a modifier can change what a long-running sketch sees immediately.

That is the model described in the early [client brainstorm](source-notes/client-brainstorm.md) and implemented by the project p5gpu proof.

The problem is that the value’s lifetime becomes an accidental consequence of Deno’s module cache.

Changing `state.ts` on disk does not replace the object already held by `sketch.ts`. Conversely, if two import URLs cease to be identical because of cache-busting or path differences, the system can get two nominally identical state modules with two independent objects.

That creates difficult questions:

- Does relaunching the state module replace its exports?
- Do existing sketches see the replacement?
- Can `Restart All` reliably get a fresh state graph?
- Which module instance owns initialization and cleanup?
- How does the browser inspect the object?
- How does an agent change it without executing another modifier module?
- How do undo, history, conflict detection, or subscriptions wrap arbitrary mutations?
- How do you serialize the state for reconnect?

The current implementation is already experiencing this ambiguity: entry modules are cache-busted, but their relative dependencies have stable URLs. Shared state persists, but partly because of Deno caching rather than an explicit livecode contract.

## Later model: imports carry types and tokens

Here, code imports a description of an entity rather than the entity’s current value:

```ts
// sceneTokens.ts
export interface SceneState {
  speed: number;
  color: [number, number, number];
}

export const sceneState = token<SceneState>("scene/main");
```

The token might conceptually be:

```ts
interface Token<T> {
  key: string;
  readonly __valueType?: T;
}
```

Modules use a stable server store:

```ts
// sketch.ts
import { sceneState } from "./sceneTokens.ts";
import { store } from "livecode-store";

while (true) {
  const state = store.get(sceneState);
  render(state.color);
  await ctx.waitFrame();
}
```

```ts
// modifier.ts
import { sceneState } from "./sceneTokens.ts";
import { store } from "livecode-store";

export default async function () {
  store.update(sceneState, (state) => ({
    ...state,
    color: [0, 255, 0],
  }));
}
```

The key invariant is:

```ts
store.get(sceneState)
```

must resolve by `sceneState.key`, not by the token object’s JavaScript identity.

If `sceneTokens.ts` is imported again and produces a new token object, both objects still mean `"scene/main"`. Code instances can come and go while the live value remains in the store.

Types and tokens remain ordinary code, so this still honors code-first topology:

- the import expresses that this module knows about `sceneState`;
- `store.get(sceneState)` statically identifies it as a reader;
- `store.set/update(sceneState)` identifies it as a writer;
- the analyzer can derive connector lines, warnings, and UI affordances from those calls;
- the connector itself remains merely a visualization of a relationship defined in code.

## Why this is not a blessed orchestrator

A global store might initially sound like a central conductor, but it need not control anything.

The store does not decide:

- which modules run;
- their execution order;
- which module is the “main” module;
- when a value must change;
- how musical processes synchronize.

It is only a durable coordination substrate. Independent modules read, write, subscribe, and dispatch actions against named entities.

That distinction is:

> Centralized state ownership does not require centralized control flow.

## What it enables

Moving live values into the store gives the broader architecture somewhere explicit to put:

- server-owned reconnectable truth;
- revisions and compare-and-set;
- subscriptions and snapshots;
- undo/redo independent of tldraw undo;
- serialized agent actions;
- an operation/audit log;
- static reader/writer detection;
- warnings for missing producers, multiple writers, stale types, or inconsistent use;
- UI views that can appear and disappear without creating or destroying the entity.

The piano roll is already the closest current example:

- modules refer to `"melody"` through helper calls;
- the server store owns the notes and revision;
- a tldraw shape is only a view onto `"melody"`;
- deleting the shape need not delete the roll;
- an agent, UI, or module can all address the same object.

The project’s imported p5gpu `state` object represents the earlier model.

## The real design choice

The strongest version of the later principle is probably not “never import values.” Constants, pure functions, immutable configuration, types, and capability definitions are perfectly reasonable imports.

A more precise principle would be:

> Imports may carry code, types, immutable definitions, and stable entity tokens. Mutable live-performance state whose identity must survive module replacement belongs in a server-owned store.

That preserves normal TypeScript modularity while making hot-reloadable shared state an intentional system contract instead of a side effect of Deno’s import cache.
