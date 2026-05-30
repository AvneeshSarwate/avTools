The tldraw discussion converged on:

### Why tldraw is still interesting

You were worried that:

* Vue Flow / Svelte Flow pinch-zoom and infinite-canvas interaction quality may not be as polished as tldraw.
* You eventually want a freeform spatial editor, not just a node graph.
* You don't want React in the hot path.

The conclusion was:

```text id="d6u2hy"
tldraw is probably the strongest off-the-shelf
infinite-canvas / camera / selection / interaction layer.
```

Even if the rest of the architecture is not React-centric.

---

### The important architectural boundary

Treat tldraw as:

```text id="w9m6b9"
spatial editor
camera
selection
dragging
resizing
layout
persistence
```

Not as:

```text id="jtns7u"
runtime state store
animation engine
60fps execution visualization layer
```

The hot runtime path should bypass the tldraw store.

---

### Custom shapes can contain arbitrary UI

A custom tldraw shape can host:

```text id="ccljlwm"
CodeMirror
HUDs
property inspectors
sliders
custom DOM
canvas overlays
```

The editor cell itself can simply be mounted inside a custom shape.

---

### 60fps updates inside a custom shape

You asked whether people actually run simulations inside tldraw components.

The answer was yes.

The important discovery was:

```text id="zwkq41"
editor.on("tick")
```

acts as a shared RAF-driven update loop.

tldraw explicitly exposes tick/frame events for things like:

```text id="r1y7s5"
physics simulations
particle systems
continuous animation
```

So a custom shape can:

```text id="l4vzgm"
mount once
subscribe to editor.tick
run forever
```

without touching shape props.

---

### Continuous updates do not require tldraw state changes

This was the key answer to your question.

You asked:

> does editor.tick continue even if the component isn't updating?

The conclusion:

```text id="4az1vn"
yes
```

A component can subscribe to tick and run continuously even when:

```text id="b6llc9"
no shape props change
no React state changes
no tldraw store updates happen
```

So:

```text id="ykp2v5"
tldraw shape
  -> mounts CodeMirror

editor.tick
  -> drives runtime visualization
  -> drives HUD updates
  -> drives physics
```

is a supported pattern.

---

### How runtime data would flow

The rough architecture we discussed:

```text id="p4n4gq"
Deno runtime
    |
    v
runtime websocket
    |
    v
runtime store
    |
    v
editor.tick
    |
    +--> CodeMirror decorators
    +--> HUDs
    +--> visual overlays
```

The important idea:

```text id="gx7yyv"
runtime events
and
tldraw state

are separate systems
```

---

### CodeMirror inside tldraw

The final position was:

CodeMirror is not just embedded content.

For your use case:

```text id="j4y02s"
CodeMirror decorators
are part of the runtime visualization system
```

and may legitimately update every frame.

That changed the earlier assumption that decorations should only change occasionally.

Instead:

```text id="t8l9u3"
runtime
 -> frame data
 -> CodeMirror decoration updates
 -> visible execution traces
```

may happen at 60fps.

---

### What was not decided

We did **not** settle on:

```text id="ikjlwm"
exact custom shape design
exact runtime store design
exact CodeMirror decoration architecture
whether tldraw is definitely the final choice
```

Only that:

```text id="jwbsux"
if using tldraw,
there is a viable architecture where:

- tldraw handles canvas interaction
- CodeMirror lives in shapes
- editor.tick provides continuous updates
- runtime visualization runs independently of tldraw state
```

That was the main conclusion of the tldraw discussion.
