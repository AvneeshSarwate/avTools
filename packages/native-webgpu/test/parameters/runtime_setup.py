from pathlib import Path
ROOT=Path('/Users/avneeshsarwate/agentCombine/avTools/packages/native-webgpu')
b=op('/avtools_parameter_probe')
assert b.op('runtime_tests') is None
callback=b.create(executeDAT,'runtime_tests');callback.par.active=False;callback.par.framestart=True
callback.text=(ROOT/'test/parameters/runtime_callbacks.py').read_text()
callback.par.active=True
print('Runtime tests started')
