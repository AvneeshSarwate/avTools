import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sdk=execFileSync('xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','test/td/bridge_probe.cpp','-o','build/bridge-probe'],{cwd:root,stdio:'inherit'});

execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','test/td/bridge_benchmark.cpp','-o','build/bridge-benchmark'],{cwd:root,stdio:'inherit'});

execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','test/td/bridge_concurrency.cpp','-o','build/bridge-concurrency'],{cwd:root,stdio:'inherit'});

execFileSync('clang++',['-std=c++17','-O2','-isysroot',sdk,'-isystem',sdk+'/usr/include/c++/v1','test/timing/bridge.cpp','-o','build/timing-bridge'],{cwd:root,stdio:'inherit'});
