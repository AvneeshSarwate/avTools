# Prebuilt TouchDesigner plugin

**Download the latest plugins** (no repository checkout needed):

- macOS Apple Silicon: [avtools-td-plugins-macos-arm64.zip](https://github.com/AvneeshSarwate/avTools/releases/download/td-plugins/avtools-td-plugins-macos-arm64.zip)
- Windows x64: [avtools-td-plugins-windows-x64.zip](https://github.com/AvneeshSarwate/avTools/releases/download/td-plugins/avtools-td-plugins-windows-x64.zip)

Extract the ZIP and copy its `Plugins` folder beside your saved `.toe`. Its
`version.json` tracks the complete distribution with an incrementing integer.
These links always point at the latest build (the rolling
[`td-plugins` release](https://github.com/AvneeshSarwate/avTools/releases/tag/td-plugins)).

New to TouchDesigner? Follow the GUI setup walkthrough for
[macOS](macos-arm64/README.md). It also ships inside the distribution's `Plugins` folder.
See [onboarding validation](ONBOARDING_VALIDATION.md) for the tested GUI flow.

Plugin binaries are **not committed to git**; they are published as release
assets so clones stay small. To run the in-repo TD examples from a fresh clone
without building native code, fetch the release into the (gitignored)
`apps/td-projects/Plugins` folder:

```sh
node packages/native-webgpu/scripts/fetch-td-plugins.mjs   # or: npm run td:fetch
```

Keep each entire `.plugin` bundle together. The compiler, watchers, MIDI bridge,
and text engine are statically linked into the plugin/runtime binaries; users do
not need a sibling `native-build/` folder.

Locally built bundles live in `macos-arm64/` under versioned names, and
`current.txt` / `current-chop.txt` name the current ones. The versioned filename
avoids replacing a binary already loaded by TouchDesigner. Saved `Sketch.toe`,
`TimeContext.toe`, and the IDE starter resolve these markers automatically when
present. A project's adjacent `Plugins/AvToolsSketch.plugin` takes priority.
These build outputs are local and gitignored.

Supported macOS target: **macOS 15+, Apple Silicon, TouchDesigner 2025.31550 / 2025.33230**.
Other TD versions are unverified. The bundle is locally ad-hoc signed, not Apple
notarized. Fonts, third-party notices, V8 and seedrandom licenses, and Syphon's
framework resources ship inside it. Its on-disk payload is approximately 81 MiB
per operator bundle.

For TypeScript editing without any developer runtime installed, use the
[native project](../../../apps/td-projects/native/README.md). Its TypeScript File
parameter and optional Create Template Project button use the embedded native
compiler. The CLI is also available for developer tests and embeds the same
SDK/template and TypeScript standard libraries. Native MIDI examples and API
instructions are included in that generated template README.

For the older external watcher workflow, Node 22.20.x and `npm run setup` in the
[starter](../../../apps/td-projects/starter/README.md) are sufficient; native
compilation is unnecessary. The optional native `npm run check` harness still
needs Apple Command Line Tools to compile its small test executable.

## Updating and publishing the binary

From `packages/native-webgpu`, run **`npm run td:pack`** to regenerate
`prebuilt/avtools-td-plugins-macos-arm64.zip` (ignored) and refresh
`apps/td-projects/Plugins` without rebuilding native code. From the repository
root, the same command is `node packages/native-webgpu/scripts/package-td.mjs`.
Identical contents retain their version; changes to shipped files increment it.
On a fresh clone, run `npm run td:fetch` first so numbering continues from the
published release.

Publish with **`npm run td:release`** (`scripts/release-td.mjs`; requires the
GitHub CLI `gh`, authenticated). It uploads this platform's ZIP to the rolling
`td-plugins` release, replacing only that platform's asset, so each platform can
be published independently from its own machine. Previous versions are not kept.

It packages the current TOP, CHOP, each referenced compiler version, and the
end-user README. Node is only a maintainer packaging dependency; consumers need
TD and their editor. `--examples` retains the older, larger example-project ZIP
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

Commit source changes; publish the matching binaries with `npm run td:release`.
The builder leaves superseded local bundles intact because a running TD process
may still use their resources; delete them when no longer needed. Do not rename or
edit files inside a signed bundle.

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
runtime has been rebuilt. The CHOP shares the V8/Dawn runtime binary for build
reuse, but creates no GPU device, renderer, or textures. See [CHOP.md](../CHOP.md).
The current Channels bundle is approximately 45 MiB on disk (it omits the TOP's
font payload). Keep it intact, including the Syphon framework used by the shared
runtime library, even though the CHOP itself performs no graphics work.

SDK 3 supports ordinary TimeContext imports. Current TOP/CHOP plugins include independent Automatic Reload, Reload, and Reset controls and full isolate retirement. See [the lifecycle guide](../RELOAD.md).
