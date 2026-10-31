"""Save only the isolated component; never overwrite the user's current project."""
from pathlib import Path
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools')
example=ROOT/'packages/native-webgpu/native/td/midi-example'
fixture=op('/project1/avtools_midi_test')
fixture.name='midi_example'
for node in fixture.children:
    if node.name.startswith(('channels','picture')) and hasattr(node.par,'Controller'):
        node.par.Controller='__avtools_none__'
        node.par.Reset.pulse()
        node.cook(force=True)
        node.viewer=True
for name in ('startup','README'):
    dat=fixture.op(name) or fixture.create(textDAT,name)
    dat.text=(example/('project_start.py' if name=='startup' else 'README.md')).read_text()
    dat.nodeX=550
    dat.nodeY=100 if name=='startup' else -100
startup=fixture.op('startup')
startup.par.language='python'
boot=fixture.op('boot') or fixture.create(executeDAT,'boot')
boot.par.start=True
boot.text="def onStart():\n    parent().op('startup').module.onStart()\n"
boot.nodeX=550;boot.nodeY=0
for i,name in enumerate(('channels1','channels2','picture1','picture2')):
    node=fixture.op(name)
    node.nodeX=(i%2)*240
    node.nodeY=100 if i<2 else -160
    info=fixture.op(name+'_info')
    if info:info.nodeX=(i%2)*240;info.nodeY=-400-(i//2)*150
fixture.save(str(example/'MIDI.tox'))
print('Saved',example/'MIDI.tox')
