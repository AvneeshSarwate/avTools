"""Save current verified fixtures in TD. Only modifies the generated components."""
from pathlib import Path
import td
example=Path(__file__).resolve().parent
repo=example.parents[4]
c=td.op('/project1/avtools_channels_example')
source=c.op('points_source') or c.create(td.textDAT,'points_source')
source.text=(repo/'apps/td-projects/channels/dist/points.js').read_text()
source.nodeX=-450;source.nodeY=-900
node=c.op('points1') or c.create(td.cplusplusCHOP,'points1')
node.par.plugin.expr='parent().par.Pluginpath';node.cook(force=True)
node.par.Outputchannels='x y';node.par.Outputsamples=10000;node.par.Sketch=source
node.inputConnectors[0].connect(c.op('controls'));node.nodeX=100;node.nodeY=-550
out=c.op('out3') or c.create(td.outCHOP,'out3');out.par.connectorder=2;out.inputConnectors[0].connect(node);out.nodeX=350;out.nodeY=-550
for n in c.children:
    if hasattr(n.par,'Outputsamples') and n!=node:n.par.Outputsamples=1
c.par.Value=1;c.par.Target=0;c.par.Duration=2
c.op('README').text += '\npoints1 generates 10,000 animated XY samples using bulk writes.\n'
c.save(str(example/'Channels.tox'))
s=td.op('/project1/avtools_channels_stress')
if s:
    probe=s.op('benchmark');probe.par.active=False
    # Saved projects write their report locally; transient test runs used artifacts/.
    probe.text=probe.text.replace(repr(str(example.parents[2]/'artifacts/chop-stress-td.json')), "str(Path(project.folder)/'stress-results.json')")
    s.par.Points=10000
    for n in s.ops('points*'):
        n.par.Sketch=s.op('lerp_source');n.par.Reset.pulse();n.cook(force=True)
    s.par.Pluginpath='Plugins/AvToolsChannels.plugin'
    s.save(str(example/'Stress.tox'))
    s.par.Pluginpath=c.par.Pluginpath.eval()
print('Saved Channels.tox / Stress.tox; points:',node.numSamples,'errors:',node.errors())
print('Pane types:',[(p.name,str(p.type)) for p in td.ui.panes])
