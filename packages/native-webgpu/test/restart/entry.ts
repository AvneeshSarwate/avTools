import {animate} from './animation.ts';
const state={ticks:0};
export function setup(host:any){animate(state).catch(console.error);function publish(){host.outputs.set('ticks',state.ticks);setTimeout(publish,1)}publish();}
export function onCook(host:any){host.outputs.set('out',1);}
