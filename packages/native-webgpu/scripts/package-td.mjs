import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const plugin=readFileSync(resolve(root,'build/td-plugin-path.txt'),'utf8').trim();
const staging=mkdtempSync(resolve(root,'build/td-release-'));
const release=resolve(staging,'avtools-sketch-macos-arm64');mkdirSync(resolve(release,'Plugins'),{recursive:true});
// Stable release name matches the example's project-relative default Plugin Path.
cpSync(plugin,resolve(release,'Plugins/AvToolsSketch.plugin'),{recursive:true,verbatimSymlinks:true});
for(const name of ['TOUCHDESIGNER.md','VALIDATION.md','TIMING.md','TIMING_VALIDATION.md','native-manifest.json','td-sketch.d.ts'])cpSync(resolve(root,name),resolve(release,name));
cpSync(resolve(root,'dist/types'),resolve(release,'dist/types'),{recursive:true});
const example=resolve(root,'native/td/example');
for(const name of ['TimeContext.toe','TimeContext.tox','TimeContext.js'])cpSync(resolve(example,name),resolve(release,name));
cpSync(resolve(example,'sketch.js'),resolve(release,'sketch.js'));
cpSync(resolve(example,'Sketch.tox'),resolve(release,'Sketch.tox'));
cpSync(resolve(example,'Sketch.toe'),resolve(release,'Sketch.toe'));
cpSync(resolve(example,'pretrigger.py'),resolve(release,'pretrigger.py'));
writeFileSync(resolve(release,'EXAMPLE.md'),readFileSync(resolve(example,'README.md'),'utf8').replaceAll('../../../TOUCHDESIGNER.md','TOUCHDESIGNER.md').replaceAll('../../../VALIDATION.md','VALIDATION.md').replaceAll('../../../TIMING.md','TIMING.md'));
const guide=resolve(release,'TOUCHDESIGNER.md');
writeFileSync(guide,readFileSync(guide,'utf8').replaceAll('(native/td/example/Sketch.tox)','(Sketch.tox)').replaceAll('(native/td/example/README.md)','(EXAMPLE.md)').replaceAll('(native/td/example/pretrigger.py)','(pretrigger.py)'));
const archive=resolve(root,'artifacts/avtools-sketch-macos-arm64-0.1.0.zip');
for(const name of ['TIMING.md','TOUCHDESIGNER.md']){const path=resolve(release,name);writeFileSync(path,readFileSync(path,'utf8').replaceAll('native/td/example/',''));}
execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',release,archive],{stdio:'inherit'});
writeFileSync(resolve(root,'artifacts/td-release-path.txt'),release+'\n');console.log(archive);
