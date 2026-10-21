# Native TypeScript compiler fixture

Open [NativeBuild.toe](NativeBuild.toe), or the editable project's
[project.toe](../../../../../apps/td-projects/native/project.toe).
Both use TypeScript in `apps/td-projects/native/`. No external watcher is required.
Four TOPs render at 1920×1080 using two different TypeScript entries; four CHOPs
use two more entries with shared helpers and independent TimeContext tasks.
Each operator selects a TypeScript File directly; no manifest is used. Info DATs expose build state and diagnostics.

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

`tools/td-native-build/tests/td-entry-setup.py` verifies both Create Template Project
buttons, collision protection, independent entry errors and shared-helper reloads
inside temporary source projects. Run it after opening the native example.
