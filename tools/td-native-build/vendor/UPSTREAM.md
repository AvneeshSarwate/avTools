# Vendored TypeScript compiler

Source: https://github.com/oxc-project/tsrs
Revision: `280b426b89cd4ecd6153cf48228826bd60a99c61` (0.18.0).
TypeScript baseline: 7.1.0-dev.20260929.
License and attribution: `tsrs/LICENSE`, `tsrs/NOTICE`.

Only the reachable compiler crates and embedded standard library declarations are
retained. `scripts/prune-vendor.mjs` reproduces the packaging selection. The
workspace member list excludes upstream tasks. Compiler implementations are
otherwise unchanged except two explicit embedding additions:

- `tsrs_ast/src/utilities_1.rs`: `avtools_reset_session_ids`, an unsafe adapter
  resetting process-wide node/symbol counters and this thread's ID blocks.
- `tsrs_ast/src/identifier.rs`: clear the source-text registry and side-flow table
  once every source file of the session is gone.

The caller must serialize checks, use a single checker thread, destroy the program
and every arena region, and retain no compiler pointers before resetting. The
adapter in `src/checker.rs` follows that ordering. The shared type-graph feature,
leaf-file release, lazy declaration cache, and incremental program reuse are not
enabled. Returned diagnostics are owned Rust strings. Compiler panics poison the
service until the host restarts; we never reuse potentially live compiler objects.

The stock one-shot CLI driver is intentionally not invoked: it assumes process
exit and leaves its program allocated. Our adapter creates a root registered
region for config/parsing/binding/host state, enables owned checker and diagnostic
regions, calls `free_unshared_program` before dropping the root region, then resets
IDs. A project watch is a separate object with no compiler pointers.

The adapter enables upstream `tsrs_core/plain-ptrs`. Default compressed pointers
reserve a fixed 32 GiB address range and abort if another loaded compiler version
already owns it. This was reproduced by loading development and release dylibs
into one host. Ordinary pointers allow plugin upgrades/coexisting versions without
that fixed-address collision; memory and timing tests cover this configuration.
