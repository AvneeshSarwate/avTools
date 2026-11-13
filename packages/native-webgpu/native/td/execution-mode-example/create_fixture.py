"""Run in TD Textport with __file__ set. Creates only execution_modes."""
from pathlib import Path
folder=Path(__file__).resolve().parent
repo=folder.parents[4]
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
root=op('/project1').create(baseCOMP,'execution_modes')
root.nodeX=500
root.nodeY=-400
controls=root.create(constantCHOP,'controls')
controls.par.name0='value';controls.par.value0=7
controls.par.name1='work_ms';controls.par.value1=0
controls.nodeX=-450;controls.nodeY=100
script=root.create(textDAT,'sketch')
script.text=(folder/'channels.js').read_text()
script.nodeX=-450;script.nodeY=-100
for i in range(4):
    node=root.create(cplusplusCHOP,'channels'+str(i+1))
    node.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip())
    node.cook(force=True)
    node.par.Outputchannels='value opposite ticks cooks pulses elapsed'
    node.par.Sketch=script
    node.par.Samecook=i==0
    node.inputConnectors[0].connect(controls)
    node.nodeX=-100+i*240;node.nodeY=150
    out=root.create(nullCHOP,'out'+str(i+1))
    out.inputConnectors[0].connect(node);out.viewer=True
    out.nodeX=node.nodeX;out.nodeY=0
    info=root.create(infoCHOP,'status'+str(i+1))
    info.par.op=node.name;info.nodeX=node.nodeX;info.nodeY=-180
    info.viewer=True
readme=root.create(textDAT,'README')
readme.text='''avTools execution modes
channels1 blocks by default; channels2-4 are buffered. Same script, independent state.
Set controls/work_ms to 10 or 50 to compare. Inspect status*/cook_ms, worker_ms,
input_age_ms, coalesced_inputs and repeated_percent_120.
Toggle Wait for Current Result without resetting. Pause playback: ticks keep
advancing on each worker, frame-based tasks wait for accepted cooks.
Event Name 1/2 followed by Send Pulse appends a digit in the pulses output.
'''
readme.nodeX=-450;readme.nodeY=-300
startup=root.create(executeDAT,'startup')
startup.text=(folder/'project_start.py').read_text();startup.par.start=True
ui.panes[0].owner=root
print('Created',root.path)
