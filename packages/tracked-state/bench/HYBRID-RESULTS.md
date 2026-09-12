# Selective external scanning benchmarks

v26.8.1, Apple M1 Max, darwin/arm64. 1000 samples after 100 warmups per case. Actual Six Sines schema: 2554 parameters. All timings are milliseconds.

```sh
cd packages/tracked-state
SCHEMA_PATH=../../../browserSynthPorts/six-sines/browser-ui/src/data/schema.json BENCH_FILTER=hybrid BENCH_ITERATIONS=1000 npm run bench
```

Each ordinary entity owns its parameter map and a two-field nested control object. The external variant assigns that control object through a retained raw reference, adds one raw edit per timed update, and scans it during drain. Both variants perform the same 50 owned parameter writes, drain, JSON encode/decode and mirror application. The pipeline includes receiver work, not just engine work.

The oversized case grows a formerly small external object to 10,001 scalar fields outside the timer. Its timed operation modifies one raw field and drains. Detachment removes that object from the store but retains and mutates the raw reference, demonstrating that its fields are no longer scanned. No size cutoff discards changes.

| Operation                                                                   |      p50 |      p95 |      p99 |      max |
| --------------------------------------------------------------------------- | -------: | -------: | -------: | -------: |
| hybrid 1 entities owned only: idle drain                                    | 0.000167 | 0.000250 | 0.001208 | 0.004208 |
| hybrid 1 entities owned only: 50 writes + drain + JSON + apply              | 0.049333 | 0.068875 | 0.089792 | 0.805667 |
| hybrid 1 entities small external subtree: idle drain                        | 0.001709 | 0.004458 | 0.007542 | 0.155875 |
| hybrid 1 entities small external subtree: 50 writes + drain + JSON + apply  | 0.053209 | 0.061833 | 0.097500 | 0.250417 |
| hybrid 10 entities owned only: idle drain                                   | 0.000458 | 0.001333 | 0.002750 | 0.516250 |
| hybrid 10 entities owned only: 50 writes + drain + JSON + apply             | 0.465708 | 0.549875 | 0.744625 | 0.844042 |
| hybrid 10 entities small external subtree: idle drain                       | 0.015250 | 0.016917 | 0.028958 | 0.664166 |
| hybrid 10 entities small external subtree: 50 writes + drain + JSON + apply | 0.518542 | 0.622292 | 0.893750 | 0.975333 |
| hybrid externally grown 10001-field subtree: raw edit + drain               | 2.943292 | 3.239041 | 3.348292 | 6.730959 |
| hybrid detached 10001-field subtree: raw edit + drain                       | 0.000333 | 0.000375 | 0.001083 | 0.240375 |

Small external scanning adds about 0.004 ms median for one entity and 0.053 ms for ten in this run. Growing the external object makes its drain cost about 2.94 ms; detaching it reduces that cost to about 0.0003 ms. These measurements are not real-time guarantees. Timer overhead dominates tiny results, and JIT/GC/scheduler outliers remain in the distributions. Heap deltas in [the raw report](hybrid-results.json) include preparation and GC and are not allocation counts.

[Earlier benchmarks](RESULTS.md) describe the implementation before selective external scanning; their fixture shape differs, so use the owned/external pairs above for direct comparison.
