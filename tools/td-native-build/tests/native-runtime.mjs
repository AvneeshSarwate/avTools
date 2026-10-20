// Developer validation, intentionally separate from the native `check` command.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {checkProject} from '../../td-sketch-build/verify.mjs';
const root=resolve(process.argv[2]??'apps/td-projects/native');
const config=JSON.parse(readFileSync(resolve(root,'avtools.json'),'utf8'));
await checkProject({root,outDir:resolve(root,config.outDir??'dist'),entries:Object.entries(config.sketches).map(([name,entry])=>({name,...entry,samples:entry.samples??1}))});
