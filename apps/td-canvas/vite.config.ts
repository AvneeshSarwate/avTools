import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ['vue', 'konva', 'zod', 'perfect-freehand'],
    alias: {
      '@': fileURLToPath(new URL('../browser-projections/src', import.meta.url)),
      '@avtools/drawing-document': fileURLToPath(new URL('../../packages/drawing-document/mod.ts', import.meta.url)),
    },
  },
  server: {fs: {allow: [fileURLToPath(new URL('../..', import.meta.url))]}},
});
