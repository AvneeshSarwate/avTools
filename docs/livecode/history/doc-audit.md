# Audit: `docs/livecode/current/` size and restatement (2026-08)

> Non-normative review, preserved as written. It audits the size and content of
> `docs/livecode/current/` against the goal that the bootstrap set be cheap
> enough to read in full at the start of every session. Token counts are
> `o200k_base` and were measured at commit `699cac7`. Start at
> `docs/livecode/README.md`.

I read all nine. Short answer: **they don't mostly restate the code — but about 40% of them does, and it's concentrated in four identifiable patterns.** The other 60% is exactly the kind of writing you're describing, and some of it is excellent.

## What's genuinely doing the job

These are the lines that earn their tokens, and they're the model for everything else:

> "Deliberately **not** registered in `entity_registry.ts`; that single omission is the whole ephemeral class."

> "`/runtime/restart-all` — It does not relaunch the prior modules despite the route name."

> "Successful HTTP response means queued, not necessarily imported or started."

> "A missing name is created at rev 1: roll writes are upserts, unlike `/params/set`."

> "`deno task test:livecode` — Unit + server + old Vue E2E only. It is not the complete current-system suite."

Every one of those is a mistake an agent would make from reading the code alone. `known-risks.md` is nearly all of this. `system-architecture.md` is the cross-module map you want. Keep them.

## The four restatement patterns

| Pattern | Where | Tokens |
|---|---|--:|
| **File maps** — path + one-line gloss | server.md, client.md | 2,193 |
| **Exhaustive catalogs** — every route, every task, every test assertion | server.md, testing-and-operations.md | 5,462 |
| **TS type transcription** — shape props, wire types pasted as code blocks | client.md, protocol.md, project-model.md | ~3,450 (all fences) |
| **Resolved-issue archaeology** | known-risks.md | 2,031 |

**File maps are the clearest cut.** `server.md`'s is 85 lines / 1,269 tokens — and `apps/deno-notebooks/livecode/architecture.md` already carries the same map as a 20-line table, better, right next to the code. The README even designates that file as the "short server-local handoff and file map." server.md's version is pure duplication of a doc that already exists.

**Catalogs are the biggest cut and the subtlest.** The route catalog is 1,766 tokens, but maybe a fifth of it is surprises and four-fifths is derivable. `/entities/create` → "Create one entity of a registered type. Status 409 when the name exists" tells an agent nothing it wouldn't infer. Compressed:

> Entity CRUD is `/entities/{create,duplicate,delete}` with conventional 404/409 — read `server.ts`. **Traps:** every `*/list` route returns a full snapshot despite the name; `/params/set` 404s on unknown names while `/piano-roll/set` upserts; there is deliberately no `/signals/set`.

Same warnings, ~15% of the tokens. `testing-and-operations.md`'s coverage map (1,967 tokens) is the extreme case — a prose inventory of what each test asserts. An agent needs "run `test:livecode:server` before touching the sync transport" and the trap about the aggregate task, not a paraphrase of `sync_transport_test.ts`.

**Type blocks are stale-by-construction.** `client.md` pastes the `livecode-editor` shape props verbatim, then adds the insight: "`projectSourceUri` gives Deno LSP the real `*.orig.ts` URI." Drop the block, keep the sentence, point at `LivecodeEditorShape.tsx`. Same for `piano-roll-view` — the code block is derivable, "Notes are deliberately absent" is not.

**Resolved sections belong in history.** Five of them, 2,031 tokens, all dated 2026-08-13. `history/README.md` exists for this.

## Target

| doc | now | target |
|---|--:|--:|
| server.md | 11,585 | ~5,000 |
| client.md | 8,548 | ~4,000 |
| protocol.md | 8,147 | ~4,500 |
| known-risks.md | 6,560 | ~4,500 |
| testing-and-operations.md | 4,991 | ~1,500 |
| project-model.md | 4,778 | ~3,000 |
| system-architecture.md | 3,236 | keep |
| analyzer-and-generated-code.md | 2,941 | keep |
| adding-an-entity-kind.md | 3,007 | keep (not bootstrap) |
| **total** | **53,793** | **~30,000** |

Bootstrap drops from ~58K to ~30K — cheap enough to always read.

## The structural cause, which matters more than any single cut

Two of these are titled **"Complete route catalog"** and **"Current coverage map."** Completeness is the wrong goal when the reader has the repo. That framing is what generates the restatement, and it's reinforced by the README's maintenance contract, which obliges updating `current/server.md` for every route change — so the natural way to satisfy it is to add a row.

If you trim without changing that, they regrow. I'd reword the contract from "must update the corresponding current doc" to something like: *"If the change adds a behavior that would surprise someone reading the code — a name that lies, an ordering constraint, a cross-module coupling — document it. If the code says it plainly, don't."* Then rename the sections to `Route traps` and `What each suite actually covers`.

One caveat on my numbers: the section boundaries are my line-range estimates, so treat the per-section token counts as ±10%. The relative picture is solid.

Want me to do the pass? I'd suggest starting with `server.md` and `testing-and-operations.md` — together that's ~7K of the ~24K reduction, and they're the two where I'm most confident nothing load-bearing is lost.
