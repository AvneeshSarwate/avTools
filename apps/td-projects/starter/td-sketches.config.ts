import type {ProjectConfig} from '../../../tools/td-sketch-build/config.d.ts';

export default {
  sketches: {
    particles: 'sketches/particles/main.ts',
    background: 'sketches/background/main.ts',
  },
  shaderDirs: ['sketches'],
  generatedDir: 'generated',
  outDir: 'dist',
} satisfies ProjectConfig;
