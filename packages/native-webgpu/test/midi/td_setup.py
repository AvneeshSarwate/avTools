"""Run via exec(compile(open(PATH).read(), PATH, 'exec')) in TD Textport."""
from pathlib import Path
import json
ROOT = Path('/Users/avneeshsarwate/agentCombine/avTools')
PACKAGE = ROOT / 'packages/native-webgpu'
old = op('/project1/avtools_midi_test')
if old and old.fetch('avtools.midi.fixture', False): old.destroy()
fixture = op('/project1').create(baseCOMP, 'avtools_midi_test')
fixture.nodeX = 0
fixture.nodeY = 0
fixture.store('avtools.midi.fixture', True)
for i in range(2):
    chop = fixture.create(cplusplusCHOP, 'channels' + str(i + 1))
    chop.par.plugin = str(PACKAGE / 'prebuilt/macos-arm64' / (PACKAGE / 'prebuilt/macos-arm64/current-chop.txt').read_text().strip())
    chop.cook(force=True)
    chop.par.Outputchannels = 'value note velocity'
    chop.par.Typescript = str(ROOT / 'tools/td-native-build/template/sketches/midi/channels.ts')
    chop.nodeX = i * 240
    chop.nodeY = 0
    chop.cook(force=True)
    top = fixture.create(cplusplusTOP, 'picture' + str(i + 1))
    top.par.plugin = str(PACKAGE / 'prebuilt/macos-arm64' / (PACKAGE / 'prebuilt/macos-arm64/current.txt').read_text().strip())
    top.cook(force=True)
    top.par.Width = 640
    top.par.Height = 360
    top.par.Typescript = str(ROOT / 'tools/td-native-build/template/sketches/midi/picture.ts')
    top.nodeX = i * 240
    top.nodeY = -180
    top.cook(force=True)
print('MIDI fixture:', fixture.path)
