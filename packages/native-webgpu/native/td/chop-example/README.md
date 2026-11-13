# Open the CHOP example

Open **[Channels.toe](Channels.toe)** in TouchDesigner on macOS Apple Silicon.
The plugin and JavaScript are already in the repository; no build or Node process
is needed. Startup resolves `prebuilt/macos-arm64/current-chop.txt` automatically.

Select the parent component to adjust **Value**, **Target**, and **Duration**.
Pulse **Trigger** to ramp gain toward Target; **Reset** restarts the scripts.
`animation1` and `animation2` own separate state. Their `value` output multiplies
the current input by animated gain during the same cook. The four `pass` CHOPs
below them propagate the current frame counter without a previous-frame queue.
The Info CHOPs expose timings. `points1` generates 10,000 animated XY samples. Inspect `animation_source` to read the bundled code.

[Channels.tox](Channels.tox) is the reusable component. When importing it into
another project, set its Plugin Path to the bundle named by `current-chop.txt`.
For a standalone copy, place that entire bundle at `Plugins/AvToolsChannels.plugin`
next to the `.toe`. See [CHOP.md](../../../CHOP.md) for the API and parameters, and
[the TypeScript project](../../../../../apps/td-projects/channels/README.md) for
IDE editing and automatic reload.

## Rebuild and verify

Build the channels IDE project first. Run `create_fixture.py` via `runpy.run_path`
in TD's Textport to create an isolated component; it refuses to replace an existing
one. Save its `Channels.tox`, then run `python3 build_projects.py` from the shell
to package the standalone and file-backed `.toe` projects using TD's serialization
tools. `project_start.py` is embedded in the saved project.

Run `verify.py` in TD for state, lifecycle, pulse, timer, and same-frame checks,
followed by 1000 measured frames. Run `stress.py` for four-instance XY buffer math
and interpolation at 10k/100k points. It creates a separate component and uses
an Execute DAT to gather real frame timings and compare every sample. Reports
are written under ignored `packages/native-webgpu/artifacts/`. See
[VALIDATION.md](VALIDATION.md) for results.

Open [Stress.toe](Stress.toe) for four CHOPs interpolating between two 10k-point XY
inputs. Select the parent component and pulse Restart to run the four benchmark
cases, including 100k points. It writes `stress-results.json` next to the project.
[Stress.tox](Stress.tox) contains the reusable benchmark network.
