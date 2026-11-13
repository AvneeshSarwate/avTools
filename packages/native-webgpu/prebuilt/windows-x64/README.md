# Start here: avTools for TouchDesigner (Windows)

Use TypeScript in VS Code to draw with p5gpu or animate channels with TimeContext,
and see the results directly in TouchDesigner. No Node, npm, Deno, Visual Studio
or Rust installation is needed for the included libraries.

This distribution supports **64-bit Windows 10 and 11** with a GPU and driver that
run TouchDesigner. Other TouchDesigner builds than the one listed in
`avtools-build-VERSION.txt` / the release notes are unverified.

## 1. Put the plugins beside your project

The ZIP contains a folder named **Plugins**. Copy that whole folder into the
folder where you will save your TouchDesigner project:

```text
MyProject\
  MyProject.toe
  Plugins\
    README.md                  <-- these instructions
    AvToolsSketch.dll          <-- image output (TOP)
    AvToolsChannels.dll        <-- numeric channel output (CHOP)
    avtools-build.exe          <-- standalone typechecker/build CLI
    avtools-build-VERSION.txt
    THIRD_PARTY_NOTICES.txt
    version.json
```

Each `.dll` is a single self-contained file: its TypeScript compiler, JavaScript
engine, GPU runtime, fonts and SDK template are all inside. You may copy just
the TOP or just the CHOP if that is all you need. Nothing needs installing.

On first use each DLL unpacks its fonts and scripts once into
`%LOCALAPPDATA%\avTools\resources\`. That folder is a cache; deleting it is safe
(it is recreated on the next load).

## 2. Load your first operator

A **TOP** produces an image. A **CHOP** produces named numeric channels, such as
position, gain or animation progress. Start with the TOP to see a picture quickly.

1. Open TouchDesigner and use **File → Save As** to save `MyProject.toe` in the
   folder next to `Plugins`.
2. In the network editor, press **Tab**, choose the **TOP** family, search for
   **CPlusPlus**, and click in the network to place a **CPlusPlus TOP**. For
   channels, choose **CHOP → CPlusPlus** instead.
3. Select the new node. Press **P** over the network editor if its parameter
   panel is hidden.
4. On the **Load** page, use the file chooser beside **Plugin Path** to select
   `Plugins\AvToolsSketch.dll` for a TOP, or `Plugins\AvToolsChannels.dll` for a CHOP.
5. If TouchDesigner asks whether to load this plugin, approve it. New pages such
   as **Build** and **Diagnostics** should appear.

See Derivative's [plugin loading instructions](https://docs.derivative.ca/Write_a_CPlusPlus_Plugin).

## 3. Generate your editable TypeScript project

1. On the operator's **Build** page, set **Template Parent Folder** to `MyProject`
   (the folder containing your `.toe`), or another existing folder.
2. Press **Create Template Project**. It creates an `avtools-project\` subfolder
   containing the SDK, `tsconfig.json`, README and example sketches. Its README
   is the complete offline script/API guide. It refuses an existing child of that
   name, so repeated clicks cannot overwrite your edits.
3. The operator selects the matching **TypeScript File** automatically:
   `avtools-project\examples\background\main.ts` (TOP) or
   `avtools-project\examples\channels\main.ts` (CHOP).
4. Keep **Automatic Builds** and **Automatic Reload** on.
5. Start TD's timeline playback and enable the node's viewer if needed. The TOP
   starter draws an orange circle at 1280×720. The CHOP starter has `value` and
   `ticks` channels. Open **Controls** to adjust them.
6. Save the `.toe` again so TD remembers the operator and file paths.

## 4. Edit in VS Code

Choose **File → Open Folder** and open **avtools-project**. Edit
`examples\background\main.ts` and save: after a successful build TD restarts the
sketch with your change. Types and IntelliSense come from the copied `sdk` folder.
Do not edit files in `.avtools` (generated caches).

## Everyday controls and troubleshooting

The controls (Automatic Builds/Reload, Reload, Reset, Info DAT diagnostics and
logs, Controls declared in TypeScript, files/UDP/OSC, MIDI, WebSockets) work as
described in the generated project README.

Windows-specific notes:

- **"Part of this app has been blocked"** or the plugin fails to load with no
  avTools error: Windows **Smart App Control** (or an organization's app control
  policy) blocks unsigned DLLs. These builds are not yet code-signed. Smart App
  Control is in Windows Security → App & browser control.
- **Syphon** output is macOS-only and is not available on Windows.
- **GPU backend:** D3D12 by default. To compare with Vulkan, start TouchDesigner
  with the environment variable `AVTOOLS_GPU_BACKEND=vulkan`.
- **Updating:** close TouchDesigner first (Windows locks loaded DLLs), then replace
  the whole `Plugins` folder.

When sharing a project, include your `.toe`, `Plugins` and `avtools-project`
folders, and make plugin/TypeScript paths relative to the project folder.

## Offline typechecking for coding agents

`Plugins\avtools-build.exe` uses the same checker as the plugins and needs no
Node, npm, `tsc` or running TouchDesigner. From the TD project folder:

```powershell
.\Plugins\avtools-build.exe check-file avtools-project\examples\background\main.ts top
.\Plugins\avtools-build.exe check-file avtools-project\examples\channels\main.ts chop
```

It prints JSON with `state`, `diagnostics` (file/line/column/message) and timing.
Exit code 0 with `state: "ready"` means success. It does not run the sketch or
validate GPU/network behavior; finish with a check in TD.
