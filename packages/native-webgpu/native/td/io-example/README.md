# Files and OSC example

Open **IO.toe** in this directory. It uses the enclosing avTools checkout's
checked-in plugins and template SDK; no Node process is needed. **IO.tox** is
the matching component. Both sketches read the local `config.json` at setup.

`channels` listens for `/target`, eases toward it using TimeContext, and replies
with `/received`. Output channels are `value target messages port`. `picture`
listens for `/x` and moves a circle horizontally. The startup script selects
available localhost ports for the two instances. `send_channels` and
`send_picture` are ordinary TD OSC Out DATs that send to them.

In the Textport, with this component as the current path, try:

```python
op('send_channels').sendOSC('/target', [0.8])
op('send_picture').sendOSC('/x', [0.2])
```

The sender DAT displays the `/received` reply. Change `config.json` and press
Reset to reread it. Saving TypeScript rebuilds/restarts automatically. Port
changes require Reset, and the corresponding sender's Network Port must match.
Read [the full API guide](../../../IO.md) for raw UDP, bundle timetags and limits.

To regenerate, run `create_fixture.py` in TD with `__file__` set, let the build
finish, and save `/project1/io_example` to this folder as `IO.tox`. Then run
`python3 packages/native-webgpu/native/td/io-example/build_projects.py` to make
portable `.tox` and `.toe` files without saving over the active user project.

The automated real-TD test is `test/io/td_test.py`. It copies each plugin into
its own temporary directory, generates a fresh template from each, builds the
OSC examples, and verifies native TD OSC Out DAT ↔ JavaScript replies, TOP
pixels, and Reset/reload port reuse. Results are in `test/io/results/`.
