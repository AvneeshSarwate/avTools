# Distribution onboarding validation

Tested 2026-10-21 on Apple Silicon, macOS 15.7.7, TouchDesigner 2025.31550.

The clean ZIP was extracted into a disposable directory outside the repository.
Operator creation, plugin selection, template generation, channel configuration,
and wiring used TouchDesigner's GUI. Editing used the installed VS Code GUI.
No repository source paths, external watcher, package installation, or native
build were needed to run the examples.

Passed:

- Created and saved a new `.toe` next to the extracted `Plugins` directory.
- Loaded `AvToolsSketch.plugin` through the CPlusPlus TOP's Plugin Path chooser.
- Generated an independent `Code` folder with Create Template Project; the
  orange starter circle appeared.
- Opened `Code` in VS Code. TypeScript recognized the generated project and
  offered typed renderer completions. The edited source had zero diagnostics.
- Saved a change to a larger green circle; TD rebuilt/restarted automatically
  and showed the change.
- Loaded `AvToolsChannels.plugin` into a second operator, selected the generated
  channels entry in the same Code folder, and set `value ticks` output channels.
  The timing counter advanced.
- Wired a Constant CHOP with `value = 0.25`; the avTools CHOP returned `0.5`.
- Reopened the saved project. The green TOP image, `0.5` channel output, and
  advancing timing counter were restored.
- Verified ZIP CRCs, absence of build caches/source checkouts, both extracted
  bundles' strict code signatures, and their relative compiler library paths.

The installed editor has existing extensions; this was not a clean macOS user
account or a fresh VS Code installation. Download quarantine/notarization was
not tested by this local extraction.

The user dismissed macOS system dialogs during reopen because the computer-use
tool cannot operate UserNotificationCenter. Verification then completed. Both
test windows were closed and the disposable extracted distribution, code folders,
and `.toe` files were deleted.
