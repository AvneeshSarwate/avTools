# Windows portability: native runtime, MIDI, and distribution

Investigated 2026-10-31. Source/documentation investigation on macOS, not a
Windows build or hardware validation. This is future-port guidance, not a
request to implement Windows now. The current work remains the
[macOS MIDI integration plan](td-native-midi-plan.md).

## Conclusion

Keep the per-operator V8 worker, TimeContext, native event queues, batching,
reload generations, typed JS API, and copy-a-Plugins-folder distribution model.
None requires a Node/Deno process, installer, or external MIDI helper process.
There is real platform/build work before Windows can run this repository; it is
not just changing the output extension.

For MIDI, independent opens can also work on modern Windows MIDI Services.
They cannot be guaranteed on legacy Windows MIDI stacks. If broad legacy
support is required, add a shared native input owner across TOP and CHOP rather
than changing the JS architecture. Defer that decision until defining the
supported Windows versions and testing representative devices.

## What the pinned MIDI dependency actually uses

The repository pins `midir` 0.10.3. Its `src/backend/mod.rs` chooses CoreMIDI on
macOS, WinMM on Windows by default, and a separate WinRT backend when the `winrt`
feature is enabled. The repository does not enable `winrt`.

The WinMM backend calls `midiInOpen` / `midiOutOpen` and explicitly handles
`MMSYSERR_ALLOCATED`. Microsoft's [midiInOpen documentation](https://learn.microsoft.com/en-us/windows/win32/api/mmeapi/nf-mmeapi-midiinopen)
identifies this as an already allocated resource. Thus the existing Rust/C ABI
can be compiled for Windows, but its device-sharing behavior depends on the
Windows MIDI stack and driver. Do not infer Windows sharing from the macOS test.

This finding was checked in the exact cached 0.10.3 crate, not just the current
upstream README. `coremidi_send_timestamped` is a macOS backend feature; it does
not make our output API scheduled or select the Windows backend.

## Modern Windows changes the sharing answer

Microsoft's [current Windows MIDI Services documentation](https://microsoft.github.io/MIDI/)
says supported, updated Windows 11 releases (currently 25H2 and later) have the
service. Its [architecture overview](https://microsoft.github.io/MIDI/overview/)
explains that existing WinMM and WinRT MIDI 1.0 calls are routed through that
service, which owns device connections and distributes data to clients.

Consequently, using the existing WinMM backend can obtain multi-client behavior
without rewriting it against the new MIDI 2.0 SDK. This is an architectural
inference from Microsoft's API compatibility contract, pending native Windows
tests with our pinned dependency. Do not require the separate new App SDK merely
to receive MIDI 1.0 through WinMM.

Do not promise this based on a Windows 11 version number alone:

- [Legacy API mode](https://microsoft.github.io/MIDI/kb/how-to-change-api-mode/)
  restores older behavior without multi-client ports; hybrid mode has additional
  device-visibility restrictions.
- Older Windows installations and some update policies may not have the service.
- Microsoft's [known issues](https://devblogs.microsoft.com/windows-music-dev/windows-midi-services-rollout-known-issues-and-workarounds/)
  identify exceptions such as an older Korg BLE WinMM driver that bypasses the
  service and is not multi-client.

Do not change users' system MIDI mode, install drivers, or modify registry values
from the plugin. Surface the actual open error and document supported configurations.

## If supporting legacy single-client devices becomes a requirement

Use one native connection per device with reference-counted subscriptions and
independent bounded delivery queues. Closing/reloading one subscription must not
close the connection used by others. Preserve per-subscriber batching/coalescing
configuration without discarding information another subscriber needs.

This owner must span both operator DLLs. Statically compiling a singleton into
each DLL would create independent owners and leave the original conflict intact.
A small shared MIDI DLL, or a deliberately shared runtime DLL, is a suitable
future implementation. It can still ship inside the same copied Plugins folder;
there is no need for a separately installed program. Avoid putting V8 or TD
objects across the broker boundary; use an explicit versioned C ABI and ownership.

The broker only coordinates our own clients. It cannot make a legacy exclusive
device simultaneously available to TD's built-in MIDI operators, another TD
process, or a DAW. OS multi-client support or another external routing arrangement
is needed for that. Do not silently claim this limitation is solved by a broker.

## Runtime and packaging audit

| Area | Can remain | Windows work |
| --- | --- | --- |
| JS execution | Per-op V8 isolate/worker, independent timers, TimeContext, generation cleanup | Build pinned V8 and bindings with Windows toolchain; verify initialization and multiple loaded versions |
| File/UDP/OSC | Existing libuv design and JS API | Windows build/link settings; paths, errors, cancellation and socket tests |
| MIDI | Rust `midir`, shared TS API, batching, C ABI | WinMM build and device tests; decide modern-service requirement vs shared legacy owner |
| CHOP | CPU input/output buffers, blocking/buffered execution | Compile against Windows TD SDK and validate threading/ABI |
| TOP | Dawn/WebGPU, p5/raw-WebGPU JS lifecycle, CPU readback/upload path | Select D3D12 instead of hardcoded Metal; disable unsupported Syphon paths |
| TypeScript builder | Embedded Rust compiler/bundler, watcher, template generation | Windows dependency compilation, Unicode/drive/UNC paths, filesystem watching, rename and file-lock tests |
| Distribution | Versioned ZIP, generated SDK/docs, copy per project, native static dependencies | `.dll` layout/resources, DLL lookup/versioning, runtime support libraries and packaging tools |

[Dawn supports D3D12 as well as Metal](https://github.com/google/dawn/blob/main/README.md),
and [libuv preserves its execution model on Windows](https://docs.libuv.org/en/v1.x/design.html).
These make the architecture suitable; they do not prove that our pinned fork and
patches already build on Windows. CPU TOP transfer remains the baseline. Syphon
is macOS-specific; a future Spout/DirectX sharing path would be a separate feature,
not a requirement for a first Windows build.

Concrete platform assumptions found locally:

- `scripts/embedding.mjs`: Apple toolchain archive/SDK, `xcrun`, mac GN path,
  ARM64 target, mac deployment settings and framework/library paths.
- `native/embedded/BUILD.gn`: Metal defines, Objective-C++ Syphon source, Apple
  frameworks, Mach-O export/install-name/rpath flags.
- `src/td-runtime.ts`: explicit `backend=metal` and Syphon handling.
- `native/embedded/Runtime.cpp`: `SecRandomCopyBytes`; replace behind a small
  platform function (or appropriate existing portable facility).
- `Bridge.cpp`, `NativeBuild.h`, `SketchTOP.cpp`, `SketchCHOP.cpp`: `dlopen`,
  `dladdr`, `RTLD_NODELETE`, and `.plugin/Contents/Resources` discovery.
- `TDParameters.h` / `PulseName.h`: Python symbols resolved with
  `dlsym(RTLD_DEFAULT, ...)`; Windows must resolve the actual TD Python module
  using a compatible mechanism. This affects generated controls and pulse names.
- `Bridge.h`: GCC visibility attributes need a Windows import/export macro.
- `scripts/build-td-plugin.mjs` / `package-td.mjs`: mac SDK location, framework
  copies, `.plugin` bundles, `codesign`, `ditto`, and `macos-arm64` paths.
- `tools/td-native-build` uses Rust `notify` and ordinary filesystem abstractions,
  but its complete compiler dependency graph and C/C++ components still require
  a Windows build audit. No claim that this is already a working Windows build.

Use small platform functions and target-specific build settings when porting,
not a wholesale host rewrite. Do not refactor all of these during macOS MIDI work.

## Bundling implications

[TouchDesigner uses DLLs for Windows plugins](https://derivative.ca/UserGuide/Write_a_CPlusPlus_Plugin).
Rust MIDI, text, TS compiler and libuv can still be compiled into our binaries;
using Windows system DLLs such as WinMM is normal and not a separately shipped
MIDI library. Build dependencies are developer requirements, not installations
novice users should perform.

Preserve the user-facing copy-folder workflow, but design its Windows internal
layout explicitly. Today each mac plugin contains a private runtime dylib.
Windows does not have that same `.plugin/Contents` or `@loader_path` convention.
Microsoft's [DLL loading rules](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)
allow dependency lookup by module name, including already loaded modules, even
when the parent plugin was opened by full path. Merely putting identically named
runtime DLLs in different folders is not a reliable version-isolation strategy.

For Windows choose either one intentionally shared compatible runtime per
distribution, or distinctly named/versioned private runtime DLLs with explicit
loading. Test TD's actual loader behavior and multiple project/plugin versions;
do not rely on process working directory or global PATH changes. Resolve resource
directories from the module location. Own/free memory within the same module and
keep C ABI boundaries explicit, especially with different CRT link modes.

Audit runtime requirements using a clean Windows machine and dependency tools:
VC runtime, any selected Dawn shader compiler components, and bundled assets.
Static versus app-local deployment is a build decision; do not promise a
dependency-free pair of DLLs before that audit. A self-contained copied folder
remains achievable without making every internal component one binary.

## Future Windows acceptance tests and decision

1. Build a native runtime/CHOP probe first; verify timers, file/UDP/OSC and reload.
2. Run the same four-listener MIDI test on modern Windows MIDI Services, plus
   physical USB hardware, output loopback, and a built-in TD MIDI listener.
3. If claiming legacy support, test a genuinely exclusive legacy device/stack;
   verify both TOP and CHOP use one owner, or fail with actionable errors.
4. Validate 1 kHz traffic, batching cadence/CPU, overflow, slow consumers,
   close/reopen and hot unplug. Do not assume macOS timer results carry over.
5. Verify D3D12 TOP rendering/readback/upload, native TS builds/watchers, generated
   parameters/pulses, resources/fonts and all existing example projects.
6. Unzip/copy on a clean machine without developer tools; open multiple instances,
   restart TD, and test multiple binary versions and paths containing Unicode.

Recommendation now: proceed with independent per-instance connections on macOS,
keep device ownership abstracted from JS, and preserve static dependency bundling.
When Windows work begins, first test the modern WinMM-through-MIDI-Services path.
Only implement a shared legacy-device owner if the supported-device policy needs
it. Recheck Microsoft's rollout/support information then; it is changing.
