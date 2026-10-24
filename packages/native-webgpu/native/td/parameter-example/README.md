# Open Parameters.toe

Open **Parameters.toe** in this directory. It uses the enclosing avTools checkout's
checked-in plugins, native compiler and SDK. No Node process or terminal watcher
is needed. **Parameters.tox** is the matching component; after dropping it into
a project inside avTools, run its `startup` DAT's `onStart()` once.

Select `picture` and its **Controls** page. Change Size, Color, Visible and Shape;
press Shuffle to reposition the shape. Edit `picture.ts` in your IDE and save.
Its literal `parameters` export defines those native controls.

Select `channels`, open **Controls**, and press **Animate**. TimeContext ramps the
`value` output over Duration seconds, reading the current Gain as it runs. An
optional wired CHOP channel named `value` scales the ramp. Pressing Animate again
replaces the animation. Edit `channels.ts` to change the behavior or controls.

Compatible parameter names/types preserve values, expressions, exports and
bindings when declarations change. A schema edit recreates the native instance
and briefly restarts the script. Ordinary code edits use normal JS reload.
Automatic Reload off retains the active code and controls; Reload adopts both,
while Reset restarts the active version. See [PARAMETERS.md](../../../PARAMETERS.md)
for the complete API and limits.

This example references the repo SDK through its tsconfig. To work outside the
checkout, copy `apps/td-projects/Plugins` beside a new saved `.toe`, use Create
Template Project, and choose its `sketches/parameters/` entries instead.

Regenerate by running `create_fixture.py` in TD with `__file__` set to its absolute
path, verify/cook the Controls pages, and save the component as Parameters.tox.
Then run `python3 packages/native-webgpu/native/td/parameter-example/build_projects.py`.
The serializer removes machine-specific plugin/source paths and creates the
standalone `.toe` without overwriting the current user project.
