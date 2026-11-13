import type {ProjectConfig} from '../../../tools/td-sketch-build/config.d.ts';
export default {
  sketches: {
    points: {entry: 'sketches/points/main.ts', target: 'chop', outputs: ['x', 'y'], samples: 10000},
    animation: {entry: 'sketches/animation/main.ts', target: 'chop', outputs: ['value', 'gain', 'ticks', 'pulses']},
    passthrough: {entry: 'sketches/passthrough/main.ts', target: 'chop', outputs: ['value']},
  },
  shaderDirs: [],
} satisfies ProjectConfig;
