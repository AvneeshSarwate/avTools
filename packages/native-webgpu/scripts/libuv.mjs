// Reproducible, static libuv. No Homebrew dependency in shipped plugins.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const {libuv:pin}=JSON.parse(readFileSync(resolve(root,'native-manifest.json'),'utf8'));
const base=resolve(root,'build/libuv'),source=resolve(base,`libuv-v${pin.version}`),out=resolve(base,'out');
mkdirSync(base,{recursive:true});
const archive=resolve(base,'source.tar.gz');
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit'});
if(!existsSync(archive))run('curl',['-fL',`https://dist.libuv.org/dist/v${pin.version}/libuv-v${pin.version}.tar.gz`,'-o',archive]);
if(createHash('sha256').update(readFileSync(archive)).digest('hex')!==pin.sha256)throw Error('libuv archive checksum mismatch');
if(!existsSync(source))run('tar',['-xzf',archive,'-C',base]);
run('cmake',['-S',source,'-B',out,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DLIBUV_BUILD_SHARED=OFF','-DLIBUV_BUILD_TESTS=OFF','-DLIBUV_BUILD_BENCH=OFF','-DCMAKE_OSX_ARCHITECTURES=arm64','-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0','-DCMAKE_POSITION_INDEPENDENT_CODE=ON']);
run('cmake',['--build',out,'--target','uv_a','-j','6']);
writeFileSync(resolve(base,'VERSION'),pin.version+'\n');
