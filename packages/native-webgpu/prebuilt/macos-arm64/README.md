# Start here: avTools for TouchDesigner

Use TypeScript in VS Code to draw with p5gpu or animate channels with TimeContext,
and see the results directly in TouchDesigner. No Node, npm, Deno, Xcode or Rust
installation is needed for the included libraries.

This distribution supports **Apple Silicon Macs running macOS 15 or later**.
It was tested with **TouchDesigner 2025.31550**. Other TD builds are unverified;
Intel Macs and Windows are not supported by these binaries.

## 1. Put the plugins beside your project

The clean distribution ZIP contains a folder named **Plugins**. Copy that whole
folder into the folder where you will save your TouchDesigner project:

```text
MyProject/
  MyProject.toe
  Plugins/
    README.md                       <-- these instructions
    AvToolsSketch.plugin            <-- image output (TOP)
    AvToolsChannels.plugin          <-- numeric channel output (CHOP)
    avtools-build                    <-- standalone typechecker/build CLI
    avtools-build-VERSION.txt        <-- compiler version
    avtools-build-NOTICES.txt        <-- CLI third-party licenses
```

Each `.plugin` is a self-contained macOS bundle, including its statically linked
TypeScript compiler, libuv, template SDK and private graphics runtime. Keep the
entire bundle intact. You may copy just the TOP or just the CHOP if that is all
you need; no sibling `native-build` directory or command-line executable is needed.

If you cloned the **repository**, run
`node packages/native-webgpu/scripts/fetch-td-plugins.mjs` to download the latest
release into `apps/td-projects/Plugins`, then copy that entire folder beside your
saved `.toe`. Use a project-local copy; this folder is replaced by fetches and
native plugin builds.

## 2. Load your first operator

A **TOP** produces an image. A **CHOP** produces named numeric channels, such as
position, gain or animation progress. Start with the TOP to see a picture quickly.

1. Open TouchDesigner and use **File → Save As** to save `MyProject.toe` in the
   folder next to `Plugins`. A `.toe` is your TouchDesigner project file.
2. In the network editor, press **Tab** to open the operator creation dialog.
   Choose the **TOP** family, search for **CPlusPlus**, and click in the network
   to place a **CPlusPlus TOP**. For channels, choose **CHOP → CPlusPlus** instead.
3. Select the new node. Press **P** while the pointer is over the network editor
   if its parameter panel is hidden.
4. On the **Load** page, use the file chooser beside **Plugin Path** to select
   `Plugins/AvToolsSketch.plugin` for a TOP, or `Plugins/AvToolsChannels.plugin`
   for a CHOP. Select the bundle itself, not a file inside it. The `+` button
   opens the chooser; you can drag the bundle from Finder into that dialog.
5. If TouchDesigner asks whether to load this plugin, approve the avTools bundle
   you downloaded. New pages such as **Build** and **Diagnostics** should appear.

This uses TouchDesigner's built-in CPlusPlus loader; you do not need the avTools
name to appear in the operator creation dialog first. See Derivative's
[plugin loading instructions](https://docs.derivative.ca/Write_a_CPlusPlus_Plugin).

## 3. Generate your editable TypeScript project

1. On the operator's **Build** page, set **Template Parent Folder** to `MyProject`
   (the folder containing your `.toe`), or another existing folder.
2. Press **Create Template Project**. It creates an `avtools-project/` subdirectory
   containing the SDK, `tsconfig.json`, README and example sketches. Its README
   is the complete offline TD script/API guide for users and coding agents. It refuses an
   existing child of that name, so repeated clicks cannot overwrite your edits.
3. The operator automatically selects the matching **TypeScript File**:
   `avtools-project/examples/background/main.ts` for the TOP, or
   `avtools-project/examples/channels/main.ts` for the CHOP.
4. Keep **Automatic Builds** and **Automatic Reload** on.
5. Start TD's timeline playback and enable the node's viewer if needed. The TOP
   starter draws an orange circle at 1280×720 (720p). The CHOP starter has `value` and `ticks`
   channels; without an input, `value` is zero and `ticks` increases.
   Open **Controls** to adjust Size, Color and Speed on the TOP, or Gain, Offset
   and Tick Interval on the CHOP.
6. Save the `.toe` again so TD remembers the operator and file paths.

The button does not create another `.toe` or copy plugins. It creates the code
folder for the operator you already placed. Building happens inside the plugin;
there is no terminal command or watcher process to start.

## 4. Edit in VS Code

In VS Code choose **File → Open Folder** and open **avtools-project** (the folder containing
`tsconfig.json`). Open `examples/background/main.ts`. Change the circle's size or
the `p.fill(...)` color and save. After a successful build, TD restarts this
sketch and displays the change. Local variables and timing tasks start fresh.

Types and IntelliSense come from the copied `sdk` folder. The default VS Code
TypeScript support is sufficient. TimeContext can be imported using
`import {launch} from '@avtools/core-timing'`; p5gpu is the `p` argument provided
to TOP callbacks. The template also includes power2d and shader-fx sources.

Do not edit files in `.avtools`: those are generated build caches. Edit your
`.ts` sources. Installing additional npm packages is optional and requires your
own package manager; the supplied libraries need no installation.

## 5. Add another sketch or a CHOP

Create another CPlusPlus TOP or CHOP and load the corresponding plugin as in
step 2. On **Build → TypeScript File**, select another entry in the **same avtools-project
folder**. Do not generate the template again. Every operator points directly to
its own `.ts` entry; there is no manifest or bundle filename to configure.

For example, duplicate `examples/background` as `sketches/second-image` in VS Code,
then select `avtools-project/sketches/second-image/main.ts` on the second TOP. Helpers can be
shared with normal imports. Two nodes may also use the same entry: their running
state is independent.

To use the existing CHOP starter on a second operator, select
`avtools-project/examples/channels/main.ts`, then set **Script → Output Channels** to
`value ticks` and **Output Samples** to `1`. These are set automatically only
on the CHOP that creates a template. To test an input, create a **Constant CHOP**,
set its first channel's name to `value` and value to `0.25`, and wire its output
connector into the avTools CHOP's first input connector. Its output `value`
should be `0.5`. Keep **Wait for Current Result** on for same-cook transforms.

## Everyday controls and troubleshooting

- **Automatic Builds** compiles saved changes. **Automatic Reload** activates
  successful changed builds. Both are needed for save-to-restart behavior.
- **Reload** (on Sketch/Script) adopts the latest successful code. **Reset**
  restarts the code already running. If Automatic Reload is off, Reset does not
  adopt a newer pending build.
- **Build error:** a warning preserves the previous working sketch. Create an
  **Info DAT**, set its **Operator** parameter to the avTools node, and leave the
  node's **Diagnostics → Info DAT View** on **Diagnostics** for build details.
- **Console messages:** switch that view to **Logs** to read
  `console.log/info/warn/error/debug` from that operator. Log Level defaults to
  Info. **Clear Logs** clears history. **Refresh Logs (No Script)** updates cached
  log metadata while paused without advancing JavaScript. Full log tables cost
  more CPU than Diagnostics; return to Diagnostics when finished inspecting them.
- **No updates:** check playback, node viewing/downstream demand, TypeScript
  File, both automatic toggles, and the build diagnostics. A runtime exception
  requires fixing the source and reloading; `console.error` alone is only a log.
- **Cannot create template:** choose an existing Template Parent Folder without
  an `avtools-project` child, and keep the entire `.plugin` bundle intact. The
  compiler and template are embedded; no sibling builder directory is needed.
- **macOS blocks a downloaded plugin:** these bundles are ad-hoc signed, not
  Apple-notarized. macOS may require its normal security approval. Preserve the
  complete extracted bundles; downloading individual files from inside a bundle
  will not reproduce the signed plugin.

When sharing the project, include your `.toe`, `Plugins`, and `avtools-project` folders.
Make plugin and TypeScript paths relative to the saved project folder (for
example `Plugins/AvToolsSketch.plugin` and `avtools-project/examples/background/main.ts`)
before moving it. Include any additional assets your sketches read.

## Download and packaging notes

Download the latest ZIP directly:
[avtools-td-plugins-macos-arm64.zip](https://github.com/AvneeshSarwate/avTools/releases/download/td-plugins/avtools-td-plugins-macos-arm64.zip)
(the rolling [`td-plugins` release](https://github.com/AvneeshSarwate/avTools/releases/tag/td-plugins)).
Extract it and copy its `Plugins` folder as described above. This link always
serves the latest build, without the rest of the repository.

GitHub's **Code → Download ZIP** instead downloads the source repository, which
does not contain plugin binaries.

## Source, builds, and distribution versions

Source lives in the avTools repository:

- `packages/native-webgpu/native/td/`: C++ TOP and CHOP operators.
- `packages/native-webgpu/native/embedded/`: embedded V8/Dawn runtime.
- `packages/native-webgpu/src/td-runtime.ts` and `src/td-chop-runtime.ts`: script hosts.
- `tools/td-native-build/`: TypeScript builder, embedded SDK, and template.
- `packages/native-webgpu/prebuilt/macos-arm64/README.md`: source for this guide.
- `packages/native-webgpu/scripts/package-td.mjs`: distribution assembly.

From `packages/native-webgpu`, **`npm run td:build`** and
**`npm run td:build:chop`** build their operator and then automatically refresh
`apps/td-projects/Plugins` and the local ZIP. The package contains the latest
built version of each operator; rebuild both after shared runtime/compiler changes.
The native build prerequisites are documented in `packages/native-webgpu/TOUCHDESIGNER.md`
and `tools/td-native-build/README.md`.

**`npm run td:pack`** refreshes the folder and ZIP from existing binaries without
compiling native code. From the repo root, use
`node packages/native-webgpu/scripts/package-td.mjs`.

`Plugins/version.json` records a simple distribution number: **1, 2, 3, …**.
It increments when shipped files change, including documentation or builder assets;
identical packaging keeps the same number. It identifies the complete TOP/CHOP/builder
set, independently of SDK versions and internal content-hashed bundle names.
Keep this file when copying Plugins so you can identify a project's installed version.
Binaries are not committed: publish the ZIP with **`npm run td:release`**, which
replaces the macOS asset of the rolling `td-plugins` GitHub release. Do not edit
generated files in `apps/td-projects/Plugins` directly.

To update an existing project, close it in TouchDesigner and replace its entire
Plugins folder with the new copy. Node and native build tools are only needed by
maintainers, not plugin users.

## Controls declared in TypeScript

New template projects include two extra examples:

* TOP: select `examples/parameters/picture.ts`, then open its **Controls** page.
  Change Size, Color, Visible or Shape, or press Shuffle.
* CHOP: select `examples/parameters/channels.ts`, set Output Channels to `value`,
  and use Gain, Duration and Animate on **Controls**.

An exported literal `parameters` object defines these native controls. Read
`host.params` (CHOP/setup/timing code) or `frame.params` (TOP draw). Named pulse
buttons call `onPulse` with their name. Compatible parameter edits preserve TD
values, expressions, exports and bindings; a changed declaration briefly restarts
the native instance. Automatic Reload off keeps the old code and controls until
Reload. Reset restarts the active version. Full API and reload behavior:
[`PARAMETERS.md`](https://github.com/AvneeshSarwate/avTools/blob/main/packages/native-webgpu/PARAMETERS.md).

The generated README lists examples for all declared control types, XY buffer
interpolation, TOP/CHOP inputs and independent TimeContext animation. Its
`.gitignore` excludes `sdk/`, caches and installed dependencies. To restore an
ignored SDK after cloning, create a fresh template with the same plugin version
in a different parent folder, then copy its `sdk/` into your code project.

## Files, UDP and OSC

Generated templates include `examples/osc/channels.ts`, `picture.ts`, `udp.ts`
and `config.json`. Both operators offer asynchronous `host.files.readText()` /
`readBytes()`, `host.udp.open()` and `host.osc.open()`. OSC callbacks run even
when TD is not cooking; output becomes visible when TD next cooks the operator.
The channel example uses TimeContext to ease toward incoming `/target` values
and replies with `/received`. Its Output Channels are `value target messages port`.
The picture example listens for `/x`. Read the listening port in the Info DAT's
log or select a Port in Controls and press Reset. Separate instances need
separate ports (the default 0 automatically chooses one).

Sockets default to localhost; explicitly bind `0.0.0.0` for LAN reception.
Incoming bundles are delivered immediately with timetag metadata. Reload/Reset
closes old sockets automatically. File paths are relative to the TypeScript
entrypoint. New assets need a Reset to be reread. The generated project README
contains examples; the full repository API guide is `packages/native-webgpu/IO.md`.

## MIDI controllers

The TOP and CHOP both include native MIDI input and output. In a generated project,
try `examples/midi/channels.ts` or `examples/midi/picture.ts`, then choose a device
on the operator’s **MIDI** parameter page. Multiple operators can use the same
controller. `examples/midi/explicit.ts` demonstrates enumeration and sending.
The generated project README contains the full typed API, batching options, and
reload behavior. No extra MIDI library installation is required.

## Browser canvas example

All supplied template sketches are under `examples/`; create `sketches/` for your
own code. Select `examples/canvas/picture.ts` on a TOP to display drawings from
the separate `apps/td-canvas` browser app. The generated README explains how to
start its local server. `examples/canvas/channels.ts` reports shape count, revision
and connection state. Generic WebSocket examples are under `examples/websocket/`.

## Offline typechecking for coding agents

The plugin distribution includes a standalone `Plugins/avtools-build` executable
(macOS Apple Silicon). It uses the same native checker as the plugins and needs
no Node, npm, Deno, `tsc`, Rust, or running TouchDesigner. Keep it with the project.
It uses the entry's nearest `tsconfig.json`, SDK and installed dependencies.

From the TD project directory, with `Plugins/` and `avtools-project/` beside the `.toe`:

```sh
./Plugins/avtools-build check-file avtools-project/examples/background/main.ts top
./Plugins/avtools-build check-file avtools-project/examples/channels/main.ts chop
# Your own entry:
./Plugins/avtools-build check-file avtools-project/sketches/my-sketch/main.ts top
```

Adjust the executable path if the folders are elsewhere. Check each entry with
its matching `top` or `chop` target. The command prints JSON with `state`,
`diagnostics` (file/line/column/message), and timing. Exit code 0 with
`state: "ready"` means success; a nonzero exit means failure. Configuration/usage
errors can instead print an error on stderr.

`check-file` checks types and requested generated shader wrappers. It may write
caches/status under `.avtools/` and wrappers under `generated/`, but it does not
publish a new JavaScript bundle or run the sketch. It does not validate GPU,
network, or other runtime behavior; finish with a check in TD.

To guarantee checking **before** the running operator reloads, turn off its
**Automatic Reload** before saving edits (for every instance using that entry).
After a successful CLI check and TD build, pulse **Reload** to adopt the result.
Automatic Builds may stay on. Merely running the CLI does not suspend TD's
existing automatic build/reload settings.
