from pathlib import Path
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
old=op('/avtools_declared_parameters')
if old:
 old.op('tests').par.active=False
 old.name='avtools_parameters_previous_'+str(old.id)
b=op('/').create(baseCOMP,'avtools_declared_parameters')
d=b.create(executeDAT,'tests');d.par.active=False;d.par.framestart=True
d.text=(ROOT/'test/declared-parameters/td_callbacks.py').read_text(encoding='utf-8');d.par.active=True
print('Declared-parameter tests started')
