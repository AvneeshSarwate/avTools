# No-op Cleanup Checker — hanoiShow

Goal of the future pass: when a scene is **disabled or its mix is 0**, the scene should do *no meaningful work* — CPU *and* memory should stop accumulating. setTimeout overhead is fine (measured: noise floor); the targets are spawning, state integration, and unbounded growth in particle arrays.

This doc is a crib sheet for that pass. Read the "What to look for" section first, then the per-file checklist.

---

## Background

Each scene in `apps/deno-notebooks/examples/hanoiShow/` exposes `setup / draw / cleanup / setupPane / state` and is composed by `combined.ts`. There are **two independent idle controls**:

| Control                             | Lives in                                            | Behavior today                                                              |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| `globalParams.<scene>Enabled` (bool) | `combined.ts`                                       | Gates the `<scene>Draw(...)` call. Nothing else.                            |
| `state.params.fade` / `mix` (0–1)   | Per-scene (`state.render.fade`, `state.params.ring.mix`, …) | Multiplies alpha, and (if coded) makes trigger branches no-op.              |

**The gap we care about:** `enabled=false` does **not** imply `mix=0`. When a scene is disabled via combined.ts, its draw is skipped but its core-timing branches and provider-tick hooks keep running at full rate. Over a long disabled period, burning_kinaree in particular spawns rectangles/snowflakes that never get drawn (and never get culled, because culling lives in the skipped draw). This is the single biggest real bug in the current architecture.

---

## Why we didn't just "do it right" the first time

See the session transcript — the user's question was "is 20 scenes × per-frame setTimeouts a problem". Answer: no, the timer loop itself is trivial (~3000–4000 setTimeouts/sec at 20 scenes = well under 1% CPU). **What matters is what the callbacks do** — and today, when enabled=false, the callbacks happily spawn/update/never-cull. That's the cleanup pass target.

---

## What to look for

### 1. Trigger loops that gate on `mix` but not on enable

In `burning_kinaree.ts`, every trigger branch checks:

```ts
const mix = state.params.xxx.mix * state.params.fade;
if (mix <= 0) continue;
```

This works when the user zeros the mix manually. It does **nothing** when `combined.ts` merely flips `globalParams.kinareeEnabled = false` — because the scene doesn't know about that flag.

**Decision to make in the pass:** either
- (a) `combined.ts` sets the scene's mix/fade to 0 when it disables the scene, and restores it when enabling, or
- (b) each scene exports a `setEnabled(bool)` (or reads a known state flag), and branches check it, or
- (c) `combined.ts` plumbs a "scene is active" callback into each scene's `setup`, and branches gate on that.

(a) is the cheapest and most consistent with the existing contract — just automate the thing the user would have had to do manually.

### 2. Particle arrays that only cull inside `draw()`

In `burning_kinaree.ts`:
- `drawRectsSection` marks dead + compacts at `length % 32 === 0`
- `drawSnowSection` marks dead + compacts at `length % 64 === 0`

Both are **only reached when `mix > 0`**. So a scene that stays at mix=0 for a long time with the spawn trigger still firing (gap #1) gets unbounded `rectangles` and `snowflakes` arrays. After the cleanup pass fixes gap #1 this becomes academic, but it's worth verifying by setting mix=0 and watching the array sizes in a long soak.

### 3. Phase integration that's *supposed* to keep running

Not everything should be skipped during idle. In `burning_kinaree.ts::draw`, the orbit phase + orbit-radius phase integration **runs unconditionally** before the `fade <= 0` early-return:

```ts
state.runtime.orbitPhase += Math.PI * 2 * ring.orbitAngularSpeed * dt;
state.runtime.orbitRadiusPhase += Math.PI * 2 * ring.orbitFrequency * dt;
if (state.params.fade <= 0) return;
```

This is **intentional** — it keeps the ring geometry continuous across mix/fade transitions (no position snap when fading back in). Don't "clean this up" into the fade gate. Leave it.

### 4. Per-frame GPU work that always runs

`combined.ts` unconditionally does `beginFrame / endFrame / alphaBlit` for every scene every frame, even disabled ones. An empty layer is still an alpha-blit pass into the composite. At 20 scenes this starts to matter on a laptop GPU.

**Not cheap to fix** — the compositor expects a fixed layer count. A conservative approach: in the per-frame loop, skip the `alphaBlit` call for a scene that's fully idle (enable=false **and** any transient effects have settled). But deciding "settled" requires either a per-scene "has-pending-draw" signal or just accepting that fade-out frames during transitions still pay the blit cost.

**Don't try to skip `beginFrame/endFrame`** — P5GPU expects the pair and its internal `loadOp: "load"` semantics break if you stop calling them (ghost-frame risk). The architecture doc calls this out (`architecture.md:549`).

**Recommendation:** don't optimize GPU passes in this cleanup pass. It's a different-shaped change. Keep the cleanup pass focused on callbacks-that-shouldn't-run.

### 5. Core-timing root tick is load-bearing — do not remove

The `while (!ctx.isCanceled) await ctx.waitSec(1/60)` at the root of each scene's `launch()` in tegaki and burning_kinaree is **not** dead code. It keeps `mostRecentDescendentTime` fresh (see `packages/core-timing/offline_time_context.ts`). Removing it would cause *newly-spawned* branches to initialize at stale logical time, producing animation skew. The SKILL doc documents this at `skills/core-timing/SKILL.md:639`. Resist the temptation to kill it.

### 6. Shared providers tick regardless

`bodyContourProvider.tick()` and `handBBoxProvider.tick()` run once per frame in combined.ts before any scene draws. They're shared across scenes, so you can't gate them on a single scene's enable. That's fine — the cost is one WS drain per frame regardless of scene count. Just note: disabling all scenes doesn't stop the providers; that's intentional.

### 7. OSC UDP listener

`p5gpu_osc_note_trail.ts` opens a UDP port in `setup()`. That listener runs regardless of enable. Cleanup note only — it's not in scope for the cleanup pass, but if full idle becomes important, the OSC receiver + its delay buffer ring need separate gating.

### 8. Burning Kinaree bg color binding in combined mode

`state.params.bgColor` is bound on the Kinaree tab but only consumed by the standalone runner. In combined mode, the global tab's RGB sliders own the compositor clear. The duplicate binding isn't load-bearing — consider removing it from `setupPane()` and keeping the value as a standalone-only local.

---

## Per-file checklist

### `combined.ts`
- [ ] **Decide idle propagation strategy** (option a/b/c above). If (a): write a helper that zeroes scene mix when enabling=false and restores when enable=true.
- [ ] Verify the per-scene `beginFrame/endFrame/alphaBlit` cost at target scene count. Measure before optimizing — it may or may not be worth a GPU-pass cleanup.
- [ ] Check: does `drawTimingOverlay` have any hidden cost when `showTiming = false`? (quick glance: it returns early, ok.)

### `burning_kinaree.ts`
- [ ] Ring pulse trigger branch: currently gates on `state.params.ring.mix * state.params.fade <= 0`. Good for manual mix=0. Fix per strategy decision.
- [ ] Rect launch trigger branch: same pattern. Same fix.
- [ ] Rect strobe trigger branch: gates on `rate <= 0` only. No mix/fade check — which is fine, strobe doesn't push anything onto arrays — it only flips a flag. But when the scene is fully idle you're still doing 4 waits/sec. Acceptable.
- [ ] Snow launch trigger branch: same as ring/rect. Same fix.
- [ ] `drawRectsSection` / `drawSnowSection`: culling only runs when `mix > 0`. Verify this doesn't leak once gap #1 is fixed.
- [ ] Leave `orbitPhase` / `orbitRadiusPhase` integration running unconditionally in `draw()` — that's on purpose.
- [ ] Consider removing `state.params.bgColor` from the exported pane (used only in standalone).

### `p5gpu_tegaki_handwriting.ts`
- [ ] Random-mode trigger loop at lines ~983–1002: gates on `paused`, `triggerMode`, and `drawableIndices.length`. No fade/glyphScale check — so a fully-faded scene still schedules ramps into glyph state. The ramps no-op visually (glyphScale=0 early-returns draw) but the state mutation runs. Consider gating trigger on `glyphScale > 0`.
- [ ] Same for `processIntersectionTriggers` and `processHandBBoxTriggers` (they run inside draw, so they already get gated when glyphScale=0 makes draw early-return — verify by inspection).
- [ ] Hand-emitter loop: check whether it no-ops cleanly when the scene is disabled. Hand particles are bounded-lifetime so accumulation is capped, but the closure work still runs.

### `p5gpu_body_text.ts`
- [ ] Draw has `if (fade <= 0) return;` near the top — good.
- [ ] No core-timing branches; all state updates happen in draw. When combined disables this scene, nothing runs. Clean.
- [ ] Spring physics `springText.tick()` runs inside draw so it stops with fade. Good.

### `p5gpu_osc_note_trail.ts`
- [ ] No scene-fade implemented (architecture doc flags this as TODO). UDP receiver runs regardless. Out of scope for this pass but flag it.

---

## Priorities

If time-boxed, do these in order:

1. **Fix gap #1** (idle propagation: combined disable → scene mix=0). Single change to `combined.ts`, maybe 15 lines. Fixes the only real accumulation bug.
2. **Audit tegaki trigger gate** (add `glyphScale > 0` check to random trigger loop). One-line change.
3. **Soak test**: start combined, disable all scenes, let it run 10 min, verify no state growth. (Use `state.runtime.rectangles.length`, `snowflakes.length`, `glyphStates` phase fields, etc.)
4. **Optional polish**: remove duplicate `bgColor` binding from kinaree's exported pane.

Don't touch:
- Core-timing root tick
- P5GPU begin/end pairs
- Phase integration in burning_kinaree draw
- Shared provider ticks

---

## Verification

After changes, the quick checks:

```
# Watch memory during an idle soak
deno run --unstable-webgpu --unstable-ffi --allow-all --v8-flags=--expose-gc \
  examples/hanoiShow/combined.ts
```

Manually disable all scenes in the Global tab. Over 5 minutes:
- CPU usage should be near-baseline (compositor + provider ticks only)
- RSS should not grow
- Individual scene state arrays (check via a temp `console.log(state.runtime.xxx.length)` in each draw or cleanup) should stay bounded

If either grows, the gate is incomplete somewhere.
