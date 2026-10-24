import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {distributionHash,writeDistributionVersion} from './td-distribution-version.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const prebuilt=resolve(root,'prebuilt/macos-arm64');
const projectPlugins=resolve(root,'../../apps/td-projects/Plugins');
// Default: the checked-in end-user distribution. --plugins-only is retained as an alias.
const pluginsOnly=!process.argv.includes('--examples');
mkdirSync(resolve(root,'build'),{recursive:true});
const staging=mkdtempSync(resolve(root,'build/td-release-'));
const release=resolve(staging,pluginsOnly?'avtools-td-macos-arm64':'avtools-sketch-macos-arm64');mkdirSync(resolve(release,'Plugins'),{recursive:true});
// Keep signed bundles intact. Read each bundle's actual compiler reference,
// rather than assuming today's compiler marker matches both shipped plugins.
const compilerTags=new Set();
for(const [marker,name] of [['current.txt','AvToolsSketch'],['current-chop.txt','AvToolsChannels']]){
  const plugin=resolve(prebuilt,readFileSync(resolve(prebuilt,marker),'utf8').trim());
  const reference=readFileSync(resolve(plugin,'Contents/Resources/native-build.txt'),'utf8').trim();
  const match=/^\.\.\/\.\.\/\.\.\/native-build\/([a-f0-9]+)\/libavtools_build\.dylib$/.exec(reference);
  if(!match)throw new Error(`Unexpected compiler reference in ${plugin}: ${reference}`);
  compilerTags.add(match[1]);
  cpSync(plugin,resolve(release,`Plugins/${name}.plugin`),{recursive:true,verbatimSymlinks:true});
}
for(const tag of compilerTags)cpSync(resolve(prebuilt,'native-build',tag),resolve(release,'Plugins/native-build',tag),{recursive:true});
const currentCompiler=readFileSync(resolve(prebuilt,'native-build/current.txt'),'utf8').trim();
if(!compilerTags.has(currentCompiler))throw new Error('Current compiler is not referenced by either plugin; rebuild plugins before packaging.');
writeFileSync(resolve(release,'Plugins/native-build/current.txt'),currentCompiler+'\n');
cpSync(resolve(prebuilt,'README.md'),resolve(release,'Plugins/README.md'));
const version=writeDistributionVersion(resolve(release,'Plugins'),projectPlugins);
mkdirSync(resolve(root,'artifacts'),{recursive:true});
if(pluginsOnly){
  writeFileSync(resolve(release,'README.md'),`# avTools for TouchDesigner — distribution ${version.version}\n\nStart with [Plugins/README.md](Plugins/README.md) for the GUI setup walkthrough.\n`);
  const archive=resolve(root,'prebuilt/avtools-td-plugins-macos-arm64.zip');
  const temporaryArchive=resolve(staging,'plugins.zip');
  const unchanged=existsSync(resolve(projectPlugins,'version.json')) &&
    readFileSync(resolve(projectPlugins,'version.json'),'utf8')===readFileSync(resolve(release,'Plugins/version.json'),'utf8') &&
    distributionHash(projectPlugins)===version.sha256;
  if(!unchanged || !existsSync(archive)){
    execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',release,temporaryArchive],{stdio:'inherit'});
    renameSync(temporaryArchive,archive);
  }
  if(!unchanged){
    // Assemble first, then swap complete directories; never copy over individual dylibs.
    const previous=resolve(staging,'previous-Plugins');
    if(existsSync(projectPlugins))renameSync(projectPlugins,previous);
    try{renameSync(resolve(release,'Plugins'),projectPlugins);}
    catch(error){if(existsSync(previous))renameSync(previous,projectPlugins);throw error;}
  }
  writeFileSync(resolve(root,'artifacts/td-plugins-release-path.txt'),resolve(projectPlugins,'..')+'\n');
  rmSync(staging,{recursive:true,force:true});
  console.log(`TouchDesigner distribution ${version.version}: ${projectPlugins}\n${archive}`);process.exit(0);
}
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
const archive=resolve(root,`artifacts/avtools-sketch-macos-arm64-${version.version}.zip`);
for(const name of ['TIMING.md','TOUCHDESIGNER.md']){const path=resolve(release,name);writeFileSync(path,readFileSync(path,'utf8').replaceAll('native/td/example/',''));}
execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',release,archive],{stdio:'inherit'});
writeFileSync(resolve(root,'artifacts/td-release-path.txt'),release+'\n');console.log(archive);
