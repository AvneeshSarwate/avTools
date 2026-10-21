import * as timing from '@avtools/core-timing';
import {createPower2DScene, StyledShape} from '@avtools/power2d/raw';
import type {Setup, Draw, OnPulse} from '@avtools/native-webgpu/td-sketch';
import {DotMaterial} from '../../generated/sketches/particles/shaders/dot.material.raw.generated.ts';
import {accent, ink} from '../../shared/palette.ts';

let scene: ReturnType<typeof createPower2DScene>;
let shapes: StyledShape<typeof DotMaterial>[];
let angle = 0;
let reversed = false;

export const setup: Setup = (p, host) => {
  scene = createPower2DScene({device: host.device, width: p.width, height: p.height,
    format: 'rgba8unorm', clearColor: {r: ink[0]/255, g: ink[1]/255, b: ink[2]/255, a: 1}});
  shapes = Array.from({length: 18}, (_, index) => {
    const shape = new StyledShape({scene, bodyMaterial: DotMaterial,
      points: Array.from({length: 16}, (_, i) => [Math.cos(i*Math.PI/8)*7, Math.sin(i*Math.PI/8)*7] as const)});
    shape.body.setUniforms({color: [accent[0], accent[1]*(0.5+index/36), accent[2], 1]});
    return shape;
  });
  host.onDispose(() => { for (const shape of shapes) shape.dispose(); });
  timing.launch(async ctx => {
    while (true) {
      await ctx.waitSec(1/60);
      angle += (reversed ? -1 : 1) * (0.005 + host.chop('amount')/4000);
    }
  });
};

export const onPulse: OnPulse = name => { if (name === 'Trigger') reversed = !reversed; };

export const draw: Draw = p => {
  shapes.forEach((shape, i) => {
    const phase = angle+i*Math.PI/9;
    shape.x = p.width/2+Math.cos(phase)*p.width*0.3;
    shape.y = p.height/2+Math.sin(phase*2)*p.height*0.25;
  });
  scene.render();
  p.image({texture: scene.outputTexture}, 0, 0);
  p.fill(255); p.textSize(15); p.text('Power2D + TimeContext | Trigger reverses', 12, 24);
};
