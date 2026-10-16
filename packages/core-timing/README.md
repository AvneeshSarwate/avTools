# Core timing

`mod.ts` exports the shared TimeContext scheduler, realtime `launch`, frame-aware
`launchBrowser`, `OfflineRunner`, tempo maps, cancellation, barriers, seeded
branch randomness, and the priority queue. Runtime hosts provide timers,
performance.now, crypto.randomUUID, promises, AbortController, and optionally RAF.

The [executable specification](spec/README.md) documents the portable fixture
format and existing logical/invariant suites. `timing_tests.ts` exports throwing
runners and does not run on import. For a direct caller, await
`runTimingTestsGuarded()` and let a rejection fail the process.

The [TouchDesigner timing guide](../native-webgpu/TIMING.md) describes the native
host adapter, independent timers while TD is paused, managed sketch lifetimes,
and the saved TimeContext.toe example. The canonical scheduling implementation
remains here; the plugin bundles it rather than maintaining a separate scheduler.
