# Prebuilt TouchDesigner plugin

This directory is committed to ordinary Git, including the native binaries. A
fresh clone can run the TD examples without Rust, CMake, Ninja, Xcode, or a native
build. No Git LFS setup is required. Keep the entire `.plugin` bundle together.

`macos-arm64/current.txt` names the current bundle relative to its own directory.
The versioned filename avoids replacing a binary already loaded by TouchDesigner.
Saved `Sketch.toe`, `TimeContext.toe`, and the IDE starter resolve this file
automatically. A project's adjacent `Plugins/AvToolsSketch.plugin` takes priority
for standalone distribution. When importing a `.tox` manually, set its Plugin Path
to the bundle named in `current.txt`.

Supported target: **macOS 15+, Apple Silicon, TouchDesigner 2025.31550 / TOP API 12**.
Other TD versions are unverified. The bundle is locally ad-hoc signed, not Apple
notarized. Fonts, third-party notices, V8 and seedrandom licenses, and Syphon's
framework resources ship inside it. Its on-disk payload is approximately 49 MiB.

For TypeScript sketch editing, Node 22.20.x and `npm run setup` in the
[starter](../../../apps/td-projects/starter/README.md) are sufficient; native
compilation is unnecessary. The optional native `npm run check` harness still
needs Apple Command Line Tools to compile its small test executable.

## Updating the binary

Follow the [native build guide](../TOUCHDESIGNER.md#build-and-runtime-ownership)
when changing the embedded runtime or C++ plugin. From `packages/native-webgpu`,
`npm run td:build` creates a new versioned bundle here, updates `current.txt`, and
also writes the ignored `build/td-plugin-path.txt` for native developer probes.
It does not rebuild Dawn/V8 itself; complete those prerequisite steps first.

Review and commit the new bundle, `current.txt`, and matching source changes
together. Remove superseded tracked bundles once they are no longer needed; the
builder deliberately leaves them intact because a running TD process may still
use their resources. Do not rename or edit files inside a signed bundle.

After editing example startup code, refresh the embedded copy with
`python3 scripts/update-td-project-startup.py`, then regenerate the IDE starter
using `python3 ../../tools/td-sketch-build/build-example.py`.
