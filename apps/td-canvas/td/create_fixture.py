"""Run this file via exec(compile(open(PATH).read(), PATH, 'exec')) in TD Textport."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3] if '__file__' in globals() else Path('/Users/avneeshsarwate/agentCombine/avTools')
PACKAGE = ROOT/'packages/native-webgpu'
existing = op('/project1/canvas_example')
if existing and existing.fetch('avtools.canvas.fixture', False):
    existing.destroy()
fixture = op('/project1').create(baseCOMP, 'canvas_example')
fixture.store('avtools.canvas.fixture', True)
fixture.nodeX = 400
fixture.nodeY = 0
for index in range(2):
    for chop in (False, True):
        name = ('channels' if chop else 'picture') + str(index + 1)
        node = fixture.create(cplusplusCHOP if chop else cplusplusTOP, name)
        marker = 'current-chop.txt' if chop else 'current.txt'
        pre = PACKAGE/'prebuilt/macos-arm64'
        node.par.plugin = str(pre/(pre/marker).read_text(encoding='utf-8').strip())
        node.cook(force=True)
        if chop:
            node.par.Outputchannels = 'shapes revision connected'
        else:
            node.par.Width = 1280
            node.par.Height = 720
        node.par.Typescript = str(ROOT/'apps/td-canvas/td'/('channels.ts' if chop else 'picture.ts'))
        node.par.Autoreload = True
        node.nodeX = index * 280
        node.nodeY = -200 if chop else 0
        node.viewer = True
        node.cook(force=True)
        info = fixture.create(infoDAT, name + '_info')
        info.par.op = node.path
        info.nodeX = node.nodeX
        info.nodeY = node.nodeY - 85
        info.nodeWidth = 180
        info.nodeHeight = 50
startup = fixture.create(textDAT, 'startup')
startup.text = (ROOT/'apps/td-canvas/td/project_start.py').read_text(encoding='utf-8')
execute = fixture.create(executeDAT, 'on_start')
execute.par.start = True
execute.text = "def onStart():\n    parent().op('startup').module.onStart()\n"
readme = fixture.create(textDAT, 'README')
readme.text = (ROOT/'apps/td-canvas/README.md').read_text(encoding='utf-8')
startup.nodeX = -300
execute.nodeX = -300
execute.nodeY = -100
readme.nodeX = -300
readme.nodeY = -200
for n in (startup, execute, readme):
    n.nodeWidth = 150
    n.nodeHeight = 65
ui.panes.current.owner = fixture
print('Canvas fixture:', fixture.path)
