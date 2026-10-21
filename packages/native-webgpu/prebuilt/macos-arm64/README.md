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
    native-build/
      current.txt
      <version>/                    <-- keep this directory name
        libavtools_build.dylib
        avtools-build
        THIRD_PARTY_NOTICES.txt
        VERSION
```

The `.plugin` items are macOS bundles: keep each entire bundle intact. The sibling
`native-build` directory contains the shared TypeScript builder and embedded
template. Keep it next to the plugins. The command-line executable is optional
for GUI use, but copying the complete folder is simplest.

If you downloaded the **repository** instead of the clean distribution, the
plugins are under `packages/native-webgpu/prebuilt/macos-arm64`. That directory
contains older versions too. `current.txt` names the current TOP bundle;
`current-chop.txt` names the current CHOP bundle. Copy those two bundles and the
`native-build` folder into your project's `Plugins` folder, plus this README.
Versioned bundle names work just as well; select those names in step 2.

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

1. On the operator's **Build** page, set **Template Directory** to a new folder
   named `Code` inside `MyProject`. You may create an empty `Code` folder in Finder
   first and select it with the folder chooser.
2. Press **Create Template Project**. Only press this once for this code folder.
   It writes the SDK, `tsconfig.json`, README and starter sketches. It refuses to
   overwrite template files that already exist.
3. The operator automatically selects the matching **TypeScript File**:
   `Code/sketches/background/main.ts` for the TOP, or
   `Code/sketches/channels/main.ts` for the CHOP.
4. Keep **Automatic Builds** and **Automatic Reload** on.
5. Start TD's timeline playback and enable the node's viewer if needed. The TOP
   starter draws an orange circle. The CHOP starter has `value` and `ticks`
   channels; without an input, `value` is zero and `ticks` increases.
6. Save the `.toe` again so TD remembers the operator and file paths.

The button does not create another `.toe` or copy plugins. It creates the code
folder for the operator you already placed. Building happens inside the plugin;
there is no terminal command or watcher process to start.

## 4. Edit in VS Code

In VS Code choose **File → Open Folder** and open **Code** (the folder containing
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
step 2. On **Build → TypeScript File**, select another entry in the **same Code
folder**. Do not generate the template again. Every operator points directly to
its own `.ts` entry; there is no manifest or bundle filename to configure.

For example, duplicate `sketches/background` as `sketches/second-image` in VS Code,
then select `Code/sketches/second-image/main.ts` on the second TOP. Helpers can be
shared with normal imports. Two nodes may also use the same entry: their running
state is independent.

To use the existing CHOP starter on a second operator, select
`Code/sketches/channels/main.ts`, then set **Script → Output Channels** to
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
- **Missing builder / cannot create template:** check that `native-build` is
  beside the plugin bundles and includes the matching version directory. Copy
  the complete matching distribution rather than mixing plugin versions.
- **macOS blocks a downloaded plugin:** these bundles are ad-hoc signed, not
  Apple-notarized. macOS may require its normal security approval. Preserve the
  complete extracted bundles; downloading individual files from inside a bundle
  will not reproduce the signed plugin.

When sharing the project, include your `.toe`, `Plugins`, and `Code` folders.
Make plugin and TypeScript paths relative to the saved project folder (for
example `Plugins/AvToolsSketch.plugin` and `Code/sketches/background/main.ts`)
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

Maintainers regenerate the checked-in ZIP with **`npm run td:pack`** from
`packages/native-webgpu`, or `node packages/native-webgpu/scripts/package-td.mjs`
from the repo root. This packages existing binaries without rebuilding them.
Commit the ZIP alongside changes to its plugins, builder or this README. Node is
needed only to run that maintainer command, not by plugin users.
