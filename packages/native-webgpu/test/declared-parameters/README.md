# Declared-parameter tests

This directory tests the production declaration bridge. The earlier feasibility
probes remain in `../parameters/`; their results are not evidence that the new
bridge passes integration testing.

## Automated checks

```sh
python3 packages/native-webgpu/test/declared-parameters/schema_test.py
cargo +1.99.1 test --manifest-path tools/td-native-build/Cargo.toml parameters::tests --lib
AVTOOLS_BUILD_BINARY=tools/td-native-build/target/release/avtools-build node --test tools/td-native-build/tests/parameters.mjs
node packages/native-webgpu/test/chop/run.mjs
node packages/native-webgpu/test/chop/run.mjs --execution --quick
node packages/native-webgpu/test/restart/run.mjs
```

`activation.cpp` tests the exact source revision handoff across native recreation,
including Auto Reload off, Reset, queued Reload, and rejection. Compile as C++17.
The native CHOP and restart suites test actual V8 host parameter snapshots,
independent timers, same-cook updates, TOP setup/draw updates, immutable tuples,
and the existing lifetime/restart and buffered execution contracts.

## Real TouchDesigner integration

Build both plugins. Create the scratch TypeScript project once:

```sh
tools/td-native-build/target/release/avtools-build init packages/native-webgpu/artifacts/declared-parameters/project
```

Adjust the repository root in `td_setup.py` and `td_callbacks.py` if needed.
Execute `td_setup.py` in TD's Textport. It creates an isolated
`/avtools_declared_parameters` component and never saves the user's `.toe`.
The Execute DAT tests blocking and buffered CHOPs plus a TOP, all declaration
kinds, value edits, actual rendered pixels, named pulses, compatible schema
changes, code-only reload, invalid code/schema, Auto Reload off, Reset, manual
Reload with a queued pulse, saved `.tox` reopening and independent copies.

Results go to `artifacts/declared-parameters/td-results.json`. On success the saved
fixture is `artifacts/declared-parameters/Parameters.tox`. Do not treat a generated
fixture or compiled plugin as a passing test: inspect `passed` and the stages.
The tests replace only their own previously created test component on rerun.

## Verified results (2026-10-23)

All 11 stages passed in TouchDesigner 2025.31550 on macOS Apple Silicon, with no
operator errors/warnings at completion. See `results/2026-10-23-td.json`.
`td_verify_example.py` also verified 300 immediate parameter edits, each followed
by a forced same-cook CHOP read, and restored controls from a saved component
whose TypeScript source was missing. Controls also survived 30 subsequent frames with the source unavailable. Those checks passed; measured total TD cook
time was 0.132 ms median / 0.201 ms p95 with the fixture's declared controls
(including TD overhead, not an isolated parameter-sampling benchmark).

The production implementation reads its helper explicitly as UTF-8 and invokes
TD's resident Python API directly. Early development attempts failed under TD's
ASCII default. Cleanup/retry and replacing an already-loaded plugin binary also
hit TD crash recovery during development. The final version 18 binaries passed
the full suite in a fresh TD session, including standalone `.toe` startup.
Restart TD when upgrading native binaries; live TypeScript/schema reload is the
separately tested workflow. The useful, portable example is
[`native/td/parameter-example/Parameters.toe`](../../native/td/parameter-example/Parameters.toe).
