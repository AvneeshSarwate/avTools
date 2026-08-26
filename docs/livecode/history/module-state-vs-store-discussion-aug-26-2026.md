# Module-Level State vs. Stores — Discussion (2026-08-26)

Verbatim exchange between the project owner and the coding agent, following the
principles audit calibration (stores are for UI-facing state; programmatic
shared state via imported state modules is fine).

## Owner's question

> if i don't care about having the state show up in the UI, i don't know that i
> see any benefit to stores over module level state other than the fact that
> module level state then creates a bit of module order dependency. however,
> for arbitrary shaped stores, given the no-blessed-orchestrators goal, i would
> want the shape defined as a module in the project anyway (since it would be
> idiosyncratic to the project), and with that in mind, imo all benefits to
> using stores for non-visualized data vanishes. if i want to take any state
> and elevate it to using it in a UI, i could just turn it into a tweak-pane
> type object? what do you think - any clear use cases or holes or gotchas

## Agent's response

I think your conclusion is basically right, and it's worth being precise about
*why*, because the one real counterargument isn't a feature of stores — it's
about what module-level state currently rests on.

**Where I agree.** For non-visualized state, the store's supposed benefits
dissolve on inspection:

- *Identity/lifetime*: both live exactly as long as the engine. A store keyed
  by name and a module instance held in the import cache have the same
  lifespan; neither survives engine restart without explicit save.
- *Shape definition*: as you say, a generic store's value shape would be
  idiosyncratic per project, so you'd define a typed accessor module anyway —
  at which point you've written the state module, just with a string key and an
  indirection layered on top. The no-blessed-orchestrators goal makes this
  decisive: there's no framework layer that could exploit the string key.
- *Observability*: if you want to *watch* a value mid-performance, signals
  already exist for exactly that, and they're cheap to sprinkle in. You don't
  need the state itself to live in a store to peek at it.
- *Elevation*: for tweakpane-shaped values the migration is genuinely a handle
  swap — `export const circle = {x: 0.5, y: 0.5}` becomes
  `export const circle = canvasParams("circle", {x: 0.5, y: 0.5})` and
  consumers don't change, because params sample the caller-held live object
  every tick anyway. And for arbitrary-shaped state, a generic store never had
  a UI story either — you'd be building a custom view regardless, so the store
  bought you nothing there too.

**The one real hole: module-state persistence is currently an accident, not a
contract.** The reason shared state survives relaunches is that dependency
reload only cache-busts the launched entry URL — which known-risks.md lists as
a *P1 hazard* ("dependency reload is not an isolate/cache reset"), and
principles.md's direction-of-travel frames the generic store as the fix ("so
shared mutable state stops being a side effect of Deno's import cache"). If you
ever "fixed" that risk toward real hot reload of dependencies, every project
using module state would silently reset on relaunch. So committing to this
pattern means making a decision: **promote relative-import instance stability
from side effect to guaranteed contract** — state modules keep their instance
across consumer relaunches, by design, forever; any future dependency-reload
feature must be explicit/opt-in. That's a one-paragraph principles edit, and
it's much cheaper than building the store. It also means the
direction-of-travel item about the generic module-state store should probably
just be deleted — its only surviving motivation was laundering this accident
into a contract, and you can do that directly.

**Two gotchas that stay even after you bless the pattern:**

1. **Running the state module creates a phantom second instance.** Launch
   cache-busts the entry URL, so if someone clicks "run" on `state.ts`, the
   engine imports a *fresh* instance and executes its default — while every
   consumer still holds the old instance via the stable relative URL. With a
   no-op default (as `browser-p5-animation/state.orig.ts` does) it's merely
   confusing; if someone puts initialization in the default — which is
   tempting — it initializes the wrong instance and looks like a mystery
   no-op. A store never has this problem, since any instance reaches the same
   name. This fits your warning-tier static check taxonomy well: "module is
   both imported by siblings and being launched directly" is cheaply
   detectable and worth a warning, not a block.

2. **Editing the state module is a silent no-op until engine restart.** Same
   cache behavior, other direction: you edit `state.ts`, the analyzer happily
   re-checks it, relaunching consumers picks up *their* new code but keeps the
   old state instance — old shape, old values. A name-keyed store only
   half-fixes this anyway (`getState(name, init)` also ignores an edited
   `init` when state exists), so shape migration of live state is
   intrinsically awkward in a hot-reload system; the store's version of the
   trap isn't better enough to justify it. Also warning-check territory:
   "edited file is a stable-URL dependency of a live run."

**One residual store-only capability**, for completeness: durable save/load
with the project. Module state can't participate in project save. But
initialization-is-code covers the normal case, and in practice "I want this
state persisted" correlates almost perfectly with "I want this state
visible/editable" — which lands it back in your stores-are-for-UI-facing-state
rule rather than contradicting it.

So: no clear use case survives for a non-UI store. The actionable residue is
(a) a principles edit that turns dependency-instance stability into a stated
contract and drops the generic-store direction-of-travel item, and (b) the two
warning-tier checks if you ever want them.
