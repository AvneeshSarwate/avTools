# Current-doc snapshot before the lean rewrite (2026-08-24)

This directory preserves the exact Markdown files that were in
`docs/livecode/current/` immediately before the 2026-08-24 architecture-doc
rewrite. They are historical, not current contracts. In particular,
`LLM-style-flags.md` and `test-audit.md` are review artifacts that no longer
live in `current/`.

The baseline was measured with the `o200k_base` encoding from Python
`tiktoken` 0.14.0:

| File | Tokens |
| --- | ---: |
| `LLM-style-flags.md` | 2,827 |
| `adding-an-entity-kind.md` | 1,524 |
| `analyzer-and-generated-code.md` | 3,027 |
| `client.md` | 8,575 |
| `known-risks.md` | 6,273 |
| `project-model.md` | 5,007 |
| `protocol.md` | 8,345 |
| `server.md` | 11,639 |
| `system-architecture.md` | 3,294 |
| `test-audit.md` | 3,365 |
| `testing-and-operations.md` | 4,642 |
| **All snapshot files** | **58,518** |
| **Old bootstrap subset** | **50,802** |

The bootstrap subset excludes the two review artifacts and the on-demand
entity-kind recipe, matching `docs/livecode/README.md` at snapshot time.

The same tokenizer measured the rewrite as follows:

| Set | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Entire `current/` directory | 58,518 | 11,234 | 80.8% |
| Bootstrap files inside `current/` | 50,802 | 10,501 | 79.3% |
| Full fresh-session bootstrap, including entrypoint, goals, and principles | 57,880 | 17,037 | 70.6% |
