#!/usr/bin/env node
import {resolve} from 'node:path';
import {loadProject,buildProject,watchProject} from './runner.mjs';
import {checkProject} from './verify.mjs';

const [command='build',config='td-sketches.config.ts']=process.argv.slice(2);
try {
  if(!['build','dev','check'].includes(command))throw Error('Usage: node cli.mjs build|dev|check [path/to/td-sketches.config.ts]');
  const configPath=resolve(config);
  if(command==='dev'){
    const watcher=await watchProject(configPath,{onFatal:()=>{process.exitCode=1;}});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await watcher.close();process.exit(0);});
  }else{
    const project=await loadProject(configPath);await buildProject(project);
    if(command==='check')await checkProject(project);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
