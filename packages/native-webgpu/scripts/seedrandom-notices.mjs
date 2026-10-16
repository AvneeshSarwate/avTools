import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
export function seedrandomNotices(root){
  const directory=resolve(root,'node_modules/seedrandom');
  const files=['seedrandom.js',...readdirSync(resolve(directory,'lib')).filter(x=>x.endsWith('.js')&&!x.endsWith('.min.js')).map(x=>'lib/'+x)];
  return files.map(file=>`seedrandom 3.0.5 / ${file}\n${readFileSync(resolve(directory,file),'utf8').match(/^\/\*[\s\S]*?\*\//)?.[0]??''}`).join('\n\n');
}
