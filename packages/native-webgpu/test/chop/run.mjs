import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),prebuilt=resolve(root,'prebuilt/macos-arm64');
const plugin=resolve(prebuilt,readFileSync(resolve(prebuilt,'current-chop.txt'),'utf8').trim());
mkdirSync(resolve(root,'build'),{recursive:true});
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1',resolve(root,'test/chop/bridge.cpp'),'-o',resolve(root,'build/chop-bridge')],{stdio:'inherit'});
execFileSync(resolve(root,'build/chop-bridge'),[resolve(plugin,'Contents/MacOS/libavtools_runtime.dylib'),resolve(plugin,'Contents/Resources')],{stdio:'inherit',timeout:120000});
