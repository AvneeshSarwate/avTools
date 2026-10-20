"""Package the TD-saved Channels.tox into portable standalone .toe examples.
Run create_fixture.py in TD first. Uses vendor serialization tools, not UI.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

example = Path(__file__).resolve().parent
repo = example.parents[4]
ide = repo / 'apps/td-projects/channels'
name = 'avtools_channels_example'

def expand(path):
    subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toeexpand', str(path)], capture_output=True)
    directory = Path(str(path)+'.dir')
    assert directory.is_dir(), path
    return directory

def text_dat(path, code):
    data = code.encode()
    path.write_bytes(path.read_bytes()[:23]+len(data).to_bytes(4,'big')+data)

def collapse(path):
    path.unlink()
    result=subprocess.run(['/Applications/TouchDesigner.app/Contents/MacOS/toecollapse', str(path)+'.toc'], capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr.decode(errors='replace')+result.stdout.decode(errors='replace'))
    assert path.is_file() and path.stat().st_size>1000, path

with tempfile.TemporaryDirectory(prefix='avtools-chop-') as temp:
    temp = Path(temp)
    tox = temp/'Channels.tox'; shutil.copy2(example/'Channels.tox',tox)
    fixture = expand(tox)
    # Avoid machine-specific plugin paths in shipped fixtures.
    p=fixture/(name+'.parm')
    lines=[line for line in p.read_text().splitlines() if not line.startswith('Pluginpath ') and line!='?']
    p.write_text('?\n'+'\n'.join(lines)+'\nPluginpath 67108928 Plugins/AvToolsChannels.plugin\n?\n')
    # The default value is also serialized in the custom parameter declaration.
    p=fixture/(name+'.cparm')
    s=p.read_text()
    import re
    s=re.sub(r'/[^\s"\n]*AvToolsChannels-[^\s"\n]*\.plugin','Plugins/AvToolsChannels.plugin',s)
    p.write_text(s)
    collapse(tox); shutil.copy2(tox,example/'Channels.tox')
    for file_backed,destination,title in [(False,example,'Channels'),(True,ide,'project')]:
        toe=temp/(title+'.toe')
        shutil.copy2(example.parent/'example/Sketch.toe',toe)
        directory=expand(toe)
        old='avtools_sketch_example'
        for path in (directory/'project1').glob(old+'*'):
            if path.is_dir(): shutil.rmtree(path)
            else: path.unlink()
        for path in fixture.iterdir():
            target=directory/'project1'/path.name
            if path.is_dir(): shutil.copytree(path,target)
            else: shutil.copy2(path,target)
        code=(example/'project_start.py').read_text().replace('FILE_BACKED = False',f'FILE_BACKED = {file_backed}')
        text_dat(directory/'project1/bootstrap.text',code)
        if file_backed:
            (ide/'project_start.py').write_text(code)
            for node in ['animation1','animation2','pass1','pass2','pass3','pass4','points1']:
                source='points' if node == 'points1' else ('animation' if node.startswith('animation') else 'passthrough')
                path=directory/'project1'/name/(node+'.parm')
                lines=[line for line in path.read_text().splitlines() if line!='?' and not line.startswith(('Sketch ','Sourcefile '))]
                lines += ['Sketch 67108928 ""',f'Sourcefile 67108945 "" "project.folder + \'/dist/{source}.js\'"']
                path.write_text('?\n'+'\n'.join(lines)+'\n?\n')
        toc=Path(str(toe)+'.toc')
        entries=[line for line in toc.read_text().splitlines() if not line.startswith('project1/'+old)]
        component_entries=['project1/'+line for line in Path(str(tox)+'.toc').read_text().splitlines() if line.startswith(name)]
        position=entries.index('perform.n')
        entries[position:position]=component_entries
        toc.write_text('\n'.join(entries)+'\n')
        # Saved pane paths refer to the renamed component. CHOP viewers use the network.
        for path in directory.rglob('*'):
            if path.is_file() and path.suffix not in ['.text']:
                try: s=path.read_text()
                except UnicodeDecodeError: continue
                if old in s: path.write_text(s.replace(old,name))
        collapse(toe);shutil.copy2(toe,destination/(title+'.toe'))
        if file_backed:
            # Export the exact file-backed component as a .tox too.
            outtox=temp/'project.tox';shutil.copy2(tox,outtox);outdir=expand(outtox)
            shutil.rmtree(outdir/name);shutil.copytree(directory/'project1'/name,outdir/name)
            collapse(outtox);shutil.copy2(outtox,ide/'project.tox')
        print(destination/(title+'.toe'))

# Standalone interpolation/stress project. Idle until Restart is pulsed.
stress = example / 'Stress.tox'
if stress.is_file():
    with tempfile.TemporaryDirectory(prefix='avtools-stress-') as temp:
        temp=Path(temp);tox=temp/'Stress.tox';shutil.copy2(stress,tox);fixture=expand(tox)
        toe=temp/'Stress.toe';shutil.copy2(example/'Channels.toe',toe);directory=expand(toe)
        stress_name='avtools_channels_stress'
        for path in (directory/'project1').glob(name+'*'):
            if path.is_dir():shutil.rmtree(path)
            else:path.unlink()
        for path in fixture.iterdir():
            target=directory/'project1'/path.name
            if path.is_dir():shutil.copytree(path,target)
            else:shutil.copy2(path,target)
        startup=(example/'project_start.py').read_text()
        startup=startup[:startup.index("    for name in ")] + "    for node in c.ops('points*'):\n        node.cook(force=True)\n        node.par.Reset.pulse()\n        node.cook(force=True)\n    layout(c, 'points1')\n    return\n"
        startup=startup.replace('avtools_channels_example',stress_name)
        text_dat(directory/'project1/bootstrap.text',startup)
        toc=Path(str(toe)+'.toc');entries=[line for line in toc.read_text().splitlines() if not line.startswith('project1/'+name)]
        entries[entries.index('perform.n'):entries.index('perform.n')]=['project1/'+line for line in Path(str(tox)+'.toc').read_text().splitlines() if line.startswith(stress_name)]
        toc.write_text('\n'.join(entries)+'\n')
        for path in directory.rglob('*'):
            if path.is_file() and path.suffix!='.text':
                try:s=path.read_text()
                except UnicodeDecodeError:continue
                if name in s:path.write_text(s.replace(name,stress_name))
        collapse(toe);shutil.copy2(toe,example/'Stress.toe')
        print(example/'Stress.toe')
