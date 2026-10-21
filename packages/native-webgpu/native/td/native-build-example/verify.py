from pathlib import Path
import json,time
root=op('/native_build_test') or op('/project1/native_build_test')
projectdir=Path(root.op('channels1').par.Typescript.eval()).parents[2]
repo=next(p for p in (projectdir,*projectdir.parents) if (p/'packages/native-webgpu/prebuilt').is_dir())
records=[]
for kind in ('channels','background'):
    for i in range(1,5):
        node=root.op(kind+str(i));node.cook(force=True)
        root.op('build_'+node.name).cook(force=True)
        records.append({'op':node.path,'errors':node.errors(),'warnings':node.warnings(),'cpu_ms':node.cpuCookTime,'info':root.op('build_'+kind+str(i)).text,'value':float(node['value'][0]) if kind=='channels' and node.numChans else None})
(repo/'packages/native-webgpu/artifacts/native-build-td.json').write_text(json.dumps(records,indent=2))
print(records)
