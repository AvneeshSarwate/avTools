import * as timing from '@avtools/core-timing';
import type {Setup, Draw, OnPulse} from '@avtools/native-webgpu/td-sketch';
import {WavesEffect} from '../../generated/sketches/background/shaders/waves.frag.raw.generated.ts';
import {accent, ink} from '../../shared/palette.ts';

let effect: WavesEffect;
let seconds = 0;

export const setup: Setup = (p, host) => {
  const source = host.device.createTexture({size: [1, 1], format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING});
  host.device.queue.writeTexture({texture: source}, new Uint8Array([...ink, 255]), {}, [1, 1]);
  effect = new WavesEffect(host.device, {src: source}, p.width, p.height, 'rgba8unorm');
  host.onDispose(() => effect.dispose());
  timing.launch(async ctx => { while (true) { await ctx.waitSec(1/60); seconds += 1/60; } });
};

export const onPulse: OnPulse = name => { if (name === 'Trigger') seconds += Math.PI; };

export const draw: Draw = (p, frame) => {
  effect.setUniforms({time: seconds, amount: Math.min(1, 0.2+frame.chop('amount')/100), color: accent});
  effect.render();
  p.image({texture: effect.outputTexture}, 0, 0);
  p.fill(255); p.textSize(15); p.text('ShaderFX + custom WGSL | Trigger shifts phase', 12, 24);
};
