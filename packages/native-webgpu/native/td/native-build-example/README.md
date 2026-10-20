# Native TypeScript compiler fixture

Open [NativeBuild.toe](NativeBuild.toe), or the editable project's
[project.toe](../../../../../apps/td-projects/native/project.toe).
Both use TypeScript in `apps/td-projects/native/`. No external watcher is required.
Four TOPs render at 1920×1080; four CHOPs independently read the wired control and
run a TimeContext task. Info DATs expose build state and diagnostics.

[User workflow and SDK](../../../../../apps/td-projects/native/README.md) ·
[Compiler architecture and validation](../../../../../tools/td-native-build/README.md)

Developer scripts:

- `create_fixture.py`: create an isolated component from TD's Textport.
- `verify.py`: record values, runtime errors, and native build diagnostics.
- `benchmark.py`: measure 900 frames while applying/restoring fixture-only source
  edits, including an intentional type error. It restores the source at completion.
- `build_projects.py`: package a TD-saved `.tox` into the standalone `.toe` files
  using TD's serialization tools. `project_start.py` resolves relocated paths.

The benchmark is not active in the saved example. Results are documented in
[VALIDATION.md](../../../../../tools/td-native-build/VALIDATION.md).

To create a new fixture from Textport, give the script its filename explicitly:

```python
path = '/path/to/avTools/packages/native-webgpu/native/td/native-build-example/create_fixture.py'
exec(compile(open(path).read(), path, 'exec'), dict(globals(), __file__=path))
```
