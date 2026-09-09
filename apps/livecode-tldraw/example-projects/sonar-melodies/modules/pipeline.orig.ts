import type { TimeContext } from "@avtools/core-timing";
import { AbletonClip } from "@avtools/music-types";
import {
  easeCirc,
  ornamentClip,
  retrogradeClip,
  rotateClip,
  scaleMap,
  scaleTranspose,
  spread,
  timeStretch,
} from "./transforms.ts";

export function chainDefaults() {
  return {
    transpose: 0.5,
    stretch: 1 / 3,
    rotate: 0.5,
    reverse: 0,
    ornament: 0,
    easing: 0.5,
  };
}
export function pipelineDefaults() {
  return {
    base: { ...chainDefaults(), spread: 0 },
    delay: chainDefaults(),
    delayTime: 0.5,
    delayEnabled: false,
  };
}
export type PipelineParams = ReturnType<typeof pipelineDefaults>;
const unit = (n: number) =>
  Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Each instance closes over ONE melody's live params. No parser or global sliders. */
export function createPipeline(
  params: PipelineParams,
  random: () => number = Math.random,
) {
  function chain(source: AbletonClip, p: ReturnType<typeof chainDefaults>) {
    let clip = scaleTranspose(
      source,
      Math.floor(unit(p.transpose) * 16 - 8),
      scaleMap.dR7,
    );
    clip = timeStretch(clip, unit(p.stretch) * 3);
    clip = rotateClip(clip, unit(p.rotate));
    clip = retrogradeClip(clip, unit(p.reverse));
    clip = ornamentClip(clip, unit(p.ornament), "dR7", random);
    return easeCirc(clip, unit(p.easing));
  }
  return {
    base(source: AbletonClip) {
      return spread(
        chain(source.clone(), params.base),
        Math.floor(unit(params.base.spread) * 4),
        "dR7",
      );
    },
    delay(base: AbletonClip) {
      return chain(base.clone(), params.delay);
    },
    delayBeats() {
      return unit(params.delayTime) ** 2 * 8;
    },
  };
}
export default async function describe(ctx: TimeContext) {
  await ctx.waitSec(0.01);
}
