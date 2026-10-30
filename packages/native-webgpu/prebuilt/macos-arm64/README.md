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
```

Each `.plugin` is a self-contained macOS bundle, including its statically linked
TypeScript compiler, libuv, template SDK and private graphics runtime. Keep the
entire bundle intact. You may copy just the TOP or just the CHOP if that is all
you need; no sibling `native-build` directory or command-line executable is needed.

If you downloaded the **repository**, copy the entire
`apps/td-projects/Plugins` folder beside your saved `.toe`. It contains the current
TOP and CHOP with their embedded TypeScript builders. Use a project-local copy; this folder
is refreshed by native plugin builds.

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
   `avtools-project/sketches/background/main.ts` for the TOP, or
   `avtools-project/sketches/channels/main.ts` for the CHOP.
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
`tsconfig.json`). Open `sketches/background/main.ts`. Change the circle's size or
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

For example, duplicate `sketches/background` as `sketches/second-image` in VS Code,
then select `avtools-project/sketches/second-image/main.ts` on the second TOP. Helpers can be
shared with normal imports. Two nodes may also use the same entry: their running
state is independent.

To use the existing CHOP starter on a second operator, select
`avtools-project/sketches/channels/main.ts`, then set **Script → Output Channels** to
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
example `Plugins/AvToolsSketch.plugin` and `avtools-project/sketches/background/main.ts`)
before moving it. Include any additional assets your sketches read.

## Download and packaging notes

The clean ZIP is checked into the repository at
`packages/native-webgpu/prebuilt/avtools-td-plugins-macos-arm64.zip`. On GitHub,
open that file and click **Download raw file**. Extract the ZIP and copy its
`Plugins` folder as described above. This downloads the distribution without the
rest of the repository or any historical plugin versions.

GitHub's **Code → Download ZIP** instead downloads the whole source repository.
The source `macos-arm64` folder retains older versions; the packaged ZIP contains
only the current pair and their required builder version(s).

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
`apps/td-projects/Plugins` and the checked-in ZIP. The package contains the latest
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
Commit the refreshed folder (including `version.json`) and ZIP together with source
changes. Do not edit generated files in `apps/td-projects/Plugins` directly.

To update an existing project, close it in TouchDesigner and replace its entire
Plugins folder with the new copy. Node and native build tools are only needed by
maintainers, not plugin users.

## Controls declared in TypeScript

New template projects include two extra examples:

* TOP: select `sketches/parameters/picture.ts`, then open its **Controls** page.
  Change Size, Color, Visible or Shape, or press Shuffle.
* CHOP: select `sketches/parameters/channels.ts`, set Output Channels to `value`,
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

Generated templates include `sketches/osc/channels.ts`, `picture.ts`, `udp.ts`
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
