# Measured results

These measurements predate selective external scanning. See [the hybrid benchmark report](HYBRID-RESULTS.md) for current owned-versus-external comparisons and oversized subtree growth.

Node v22.20.0, Apple M1 Max, darwin/arm64. Actual Six Sines schema: 2554 parameters. Final run: 1,000 measured iterations after 100 warmups per case, after the signed-zero transport normalization and strict array-prototype fixes. Timings are milliseconds per named operation. Shared development machine, not an isolated realtime host. Parent validation finished before this run; no concurrent parent benchmark or test work was running.

Reproduce from this package:

```sh
BENCH_ITERATIONS=1000 SCHEMA_PATH=../../../browserSynthPorts/six-sines/browser-ui/src/data/schema.json npm run bench
```

[Final raw report](results.json) includes heap deltas and environment metadata. [Baseline raw report](baseline.json) records the initial whole-array strategy and proxy-based reconciliation, with the same schema but 200 measured samples. Timer overhead dominates the smallest measurements. Heap deltas include untimed preparation and GC, not actual allocation counts. No forced GC or audio-worklet measurements. Outliers are retained; results are observations, not portable deadline guarantees.

## Optimization comparison

| Operation                                | Baseline p50 (200 samples) | Final p50 (1,000 samples) |
| ---------------------------------------- | -------------------------: | ------------------------: |
| 10 entities: unchanged reconcile         |                  49.357458 |                 21.430834 |
| 10 entities: tiny merge + drain          |                   0.061875 |                  0.053833 |
| 10 entities: full snapshots              |                   9.543875 |                  8.162917 |
| array 10000: point write + drain + apply |                   0.337375 |                  0.000958 |

Reconciliation now traverses internal raw objects and routes mutations through the same tracking helpers; snapshots assign normal keys without descriptor allocation. Full-tree operations remain explicit load/save work, not hidden inside sparse setters or idle drains. A synchronous full load can still stall a scheduler.

Indexed and nested-leaf patches avoid full-array copying for sparse edits. Direct dense writes collapse after 64 distinct indices; structural changes/deletions still copy the affected array. Reverse, sort, and front insertion remain O(n) native mutations through proxies. The front-splice case replaces one element (same length); the separate front-insertion + pop case really shifts the array.

## Final distributions

| Operation                                  |       p50 |       p95 |       p99 |       max |
| ------------------------------------------ | --------: | --------: | --------: | --------: |
| plain: 50 assignments                      |  0.002250 |  0.003209 |  0.003292 |  0.014167 |
| 1 entities: idle drain                     |  0.000167 |  0.000250 |  0.001333 |  0.085416 |
| 1 entities: 50 tracked assignments each    |  0.015042 |  0.017500 |  0.033459 |  0.115666 |
| 1 entities: drain 50 dirty keys each       |  0.006459 |  0.007125 |  0.058459 |  0.075583 |
| 1 entities: write + drain + JSON + apply   |  0.038833 |  0.044667 |  0.093250 |  0.122084 |
| 1 entities: 20x50 automation + drain       |  0.281583 |  0.339250 |  0.379583 |  0.499083 |
| 1 entities: full snapshots                 |  0.806500 |  0.913833 |  0.969709 |  1.150792 |
| 1 entities: unchanged reconcile            |  2.127459 |  2.349291 |  2.471708 |  3.559542 |
| 1 entities: tiny merge + drain             |  0.006250 |  0.007459 |  0.011167 |  0.333875 |
| 1 entities: changed reconcile + drain      |  2.058667 |  2.255833 |  2.376000 |  2.492459 |
| 10 entities: idle drain                    |  0.000666 |  0.000709 |  0.000958 |  0.007292 |
| 10 entities: 50 tracked assignments each   |  0.146667 |  0.157208 |  0.172833 |  0.203459 |
| 10 entities: drain 50 dirty keys each      |  0.064833 |  0.095833 |  0.219000 |  0.401125 |
| 10 entities: write + drain + JSON + apply  |  0.402792 |  0.522541 |  0.571583 |  0.635917 |
| 10 entities: 20x50 automation + drain      |  2.900625 |  3.102167 |  3.237458 |  3.316959 |
| 10 entities: full snapshots                |  8.162917 |  8.466875 |  8.650292 | 23.312666 |
| 10 entities: unchanged reconcile           | 21.430834 | 21.935041 | 22.383791 | 23.495875 |
| 10 entities: tiny merge + drain            |  0.053833 |  0.066375 |  0.258958 |  0.368250 |
| 10 entities: changed reconcile + drain     | 20.847042 | 21.376000 | 22.410958 | 24.735708 |
| full JSON stringify baseline               |  0.287292 |  0.304792 |  0.333958 |  0.485292 |
| registration clone + graph adoption        |  1.451750 |  2.282667 |  2.467750 |  3.219792 |
| array 100: point write + drain + apply     |  0.002291 |  0.002791 |  0.005083 |  0.815083 |
| array 100: reverse mutation only           |  0.038667 |  0.043208 |  0.057958 |  0.476500 |
| array 100: front splice + drain            |  0.001458 |  0.001584 |  0.001958 |  0.005875 |
| array 100: sort + drain                    |  0.040917 |  0.044916 |  0.058792 |  0.199084 |
| array 100: nested leaf + drain + apply     |  0.002000 |  0.002208 |  0.003208 |  0.024000 |
| array 100: front insertion + pop + drain   |  0.040667 |  0.058958 |  0.076292 |  0.343584 |
| array 10000: point write + drain + apply   |  0.000958 |  0.001084 |  0.001500 |  0.229500 |
| array 10000: reverse mutation only         |  3.666167 |  3.821625 |  3.883208 |  3.967958 |
| array 10000: front splice + drain          |  0.001458 |  0.001583 |  0.001792 |  0.005125 |
| array 10000: sort + drain                  |  3.871500 |  4.047584 |  4.123125 |  4.186375 |
| array 10000: nested leaf + drain + apply   |  0.001083 |  0.001334 |  0.001791 |  0.025500 |
| array 10000: front insertion + pop + drain |  3.865042 |  4.039958 |  4.112000 |  4.219041 |
