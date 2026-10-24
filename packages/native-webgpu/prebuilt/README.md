# Prebuilt TouchDesigner plugin

The ready-to-copy **[apps/td-projects/Plugins](../../../apps/td-projects/Plugins)**
folder is checked in alongside the ZIP. Copy it beside your saved `.toe`.
Its `version.json` tracks the complete distribution with an incrementing integer.

New to TouchDesigner? Follow the [GUI setup walkthrough](macos-arm64/README.md).
It also ships inside the clean distribution's `Plugins` folder.
See [onboarding validation](ONBOARDING_VALIDATION.md) for the tested GUI flow.

This directory is committed to ordinary Git, including the native binaries. A
fresh clone can run the TD examples without Rust, CMake, Ninja, Xcode, or a native
build. No Git LFS setup is required. Keep the entire `.plugin` bundle together,
plus the sibling `native-build/` directory for native project compilation and
Source File watching. When distributing `Plugins/AvToolsSketch.plugin` or
`Plugins/AvToolsChannels.plugin`, put `native-build/` in that same Plugins folder.

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

For TypeScript editing without any developer runtime installed, use the
[native project](../../../apps/td-projects/native/README.md). Its TypeScript File
parameter and optional Create Template Project button use the signed CLI/shared library under
`macos-arm64/native-build/<version>/`. Both plugins resolve that one canonical
library so their compiler service and watchers are shared. The CLI itself is a
standalone executable and embeds the SDK/template and TypeScript standard libraries.

For the older external watcher workflow, Node 22.20.x and `npm run setup` in the
[starter](../../../apps/td-projects/starter/README.md) are sufficient; native
compilation is unnecessary. The optional native `npm run check` harness still
needs Apple Command Line Tools to compile its small test executable.

## Updating the binary

The clean [plugin ZIP](avtools-td-plugins-macos-arm64.zip) is checked into ordinary
Git. On GitHub, open that file and use **Download raw file** to download just the
ZIP. Extract it and follow `Plugins/README.md`; no repository checkout is needed.

From `packages/native-webgpu`, run **`npm run td:pack`** to regenerate
`prebuilt/avtools-td-plugins-macos-arm64.zip`. From the repository root, the
same command is `node packages/native-webgpu/scripts/package-td.mjs`.
This also refreshes `apps/td-projects/Plugins`. Identical contents retain their
version; changes to shipped files increment it. Commit the folder, version file,
and ZIP together.
It packages the current TOP, CHOP, each referenced compiler version, and the
end-user README without rebuilding native code. Commit the regenerated ZIP
whenever shipping plugins, compiler assets or the end-user guide change. Node is
only a maintainer packaging dependency; consumers need TD and their editor.
The source directory keeps historical versions, but the ZIP contains only the
current distribution. `--examples` retains the older, larger example-project ZIP
under ignored `artifacts/` (and requires the built `dist/types` tree).

Follow the [native build guide](../TOUCHDESIGNER.md#build-and-runtime-ownership)
when changing the embedded runtime or C++ plugin. From `packages/native-webgpu`,
`npm run td:build` creates a new versioned bundle here, updates `current.txt`, and
also writes the ignored `build/td-plugin-path.txt` for native developer probes.
Both `td:build` and `td:build:chop` then run packaging automatically, refreshing
the copyable Plugins folder and ZIP from the current TOP/CHOP pair.
It uses the packaged native compiler named by `native-build/current.txt`.
To change that service, follow [its build guide](../../../tools/td-native-build/README.md)
and package it before rebuilding both plugins. It does not rebuild Dawn/V8 itself; complete those prerequisite steps first.

Review and commit the new bundle, `current.txt`, and matching source changes
together. Remove superseded tracked bundles once they are no longer needed; the
builder deliberately leaves them intact because a running TD process may still
use their resources. Do not rename or edit files inside a signed bundle.

After editing example startup code, refresh the embedded copy with
`python3 scripts/update-td-project-startup.py`, then regenerate the IDE starter
using `python3 ../../tools/td-sketch-build/build-example.py`.

## Channels CHOP

`macos-arm64/current-chop.txt` names the separate **AvToolsChannels** bundle.
It supports TD 2025.31550 / CHOP API 10 on the same macOS Apple Silicon target.
Open [Channels.toe](../native/td/chop-example/Channels.toe), or use the
[channels IDE project](../../../apps/td-projects/channels/README.md).
For standalone distribution, use `Plugins/AvToolsChannels.plugin` beside the `.toe`.

`npm run td:build:chop` builds/publishes this bundle after the shared embedded
runtime has been rebuilt. Commit the new bundle, `current-chop.txt`, and source
together. The CHOP shares the V8/Dawn runtime binary for build reuse, but creates
no GPU device, renderer, or textures. See [CHOP.md](../CHOP.md).
The current Channels bundle is approximately 45 MiB on disk (it omits the TOP's
font payload). Keep it intact, including the Syphon framework used by the shared
runtime library, even though the CHOP itself performs no graphics work.

SDK 3 supports ordinary TimeContext imports. Current TOP/CHOP plugins include independent Automatic Reload, Reload, and Reset controls and full isolate retirement. See [the lifecycle guide](../RELOAD.md).
