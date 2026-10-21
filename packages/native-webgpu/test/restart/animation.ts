import {launch} from '../../../core-timing/mod.ts';
// This module has no TD imports or host object; the Node test uses it unchanged.
export function animate(state: {ticks:number}) {
  return launch(async ctx => {while(true){state.ticks++;await ctx.waitSec(.01);}});
}
