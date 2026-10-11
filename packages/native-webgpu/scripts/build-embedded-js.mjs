import {build} from 'esbuild';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const fonts=resolve(root,'dist/fonts');
const files=readdirSync(fonts).filter(n=>/\.(ttf|otf|woff2?)$/i.test(n)).sort((a,b)=>a.localeCompare(b)).map(n=>resolve(fonts,n));
const output=await build({entryPoints:[resolve(root,'test/embedded-p5.ts')],bundle:true,platform:'neutral',format:'iife',target:'es2022',nodePaths:[resolve(root,'node_modules')],write:false});
writeFileSync(resolve(root,'build/embedded-p5.js'),'const fontPaths='+JSON.stringify(files)+';\n'+output.outputFiles[0].text);
