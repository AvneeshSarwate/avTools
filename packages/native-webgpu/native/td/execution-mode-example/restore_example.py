"""Restore the editable example after running benchmark.py; leaves benchmark helpers inactive."""
from pathlib import Path
root=op('/project1/execution_modes')
folder=Path(__file__).resolve().parent
repo=folder.parents[4]
prebuilt=repo/'packages/native-webgpu/prebuilt/macos-arm64'
for node in root.children:node.viewer=False
if root.op('benchmark'):root.op('benchmark').par.active=False
root.op('controls').par.value0=7;root.op('controls').par.value1=0
for i in range(1,5):
    node=root.op('channels'+str(i));node.par.plugin=str(prebuilt/(prebuilt/'current-chop.txt').read_text().strip());node.cook(force=True)
    node.par.Outputchannels='value opposite ticks cooks pulses elapsed';node.par.Outputsamples=1;node.par.Sketch=root.op('sketch');node.par.Samecook=(i==1)
    node.inputConnectors[0].connect(root.op('controls'))
    if node.inputConnectors[1].connections:node.inputConnectors[1].disconnect()
    node.par.Reset.pulse();node.cook(force=True)
    root.op('out'+str(i)).viewer=True
# Keep helper DATs/operators present but inactive. TD 2025.31550 has crashed
# in queued UI/DAT callbacks when these were destroyed immediately after use.
root.unstore('benchmark_repo');root.unstore('points')
print('Example restored')
