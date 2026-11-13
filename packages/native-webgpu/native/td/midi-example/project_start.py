"""Resolve checked-in plugins and TypeScript entries from this example's folder."""
from pathlib import Path

def onStart():
    folder = Path(project.folder)
    repo = next((p for p in (folder, *folder.parents)
                 if (p/'packages/native-webgpu/prebuilt/macos-arm64/current.txt').is_file()), None)
    if repo is None:
        raise RuntimeError('Keep MIDI.toe in the avTools checkout, or generate a standalone template from the copied plugins.')
    root = me.parent()
    pre = repo/'packages/native-webgpu/prebuilt/macos-arm64'
    sources = repo/'packages/native-webgpu/native/td/midi-example'
    for name in ('channels1', 'channels2', 'picture1', 'picture2'):
        node = root.op(name)
        channel = name.startswith('channels')
        marker = 'current-chop.txt' if channel else 'current.txt'
        node.par.plugin = str(pre/(pre/marker).read_text(encoding='utf-8').strip())
        node.cook(force=True)
        node.par.Typescript = str(sources/('channels.ts' if channel else 'picture.ts'))
        node.par.Autoreload = True
        node.viewer = True
        node.cook(force=True)
