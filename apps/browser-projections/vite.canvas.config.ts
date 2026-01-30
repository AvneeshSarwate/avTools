import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue({
      customElement: true,
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      { find: '@avtools/core-timing', replacement: fileURLToPath(new URL('../../packages/core-timing/mod.ts', import.meta.url)) },
      { find: '@avtools/creative-algs', replacement: fileURLToPath(new URL('../../packages/creative-algs/mod.ts', import.meta.url)) },
      { find: '@avtools/music-types', replacement: fileURLToPath(new URL('../../packages/music-types/mod.ts', import.meta.url)) },
      { find: '@avtools/ui-bridge', replacement: fileURLToPath(new URL('../../packages/ui-bridge/mod.ts', import.meta.url)) },
      { find: '@avtools/power2d/generated', replacement: fileURLToPath(new URL('../../packages/power2d/generated', import.meta.url)) },
      { find: '@avtools/power2d/generated-raw', replacement: fileURLToPath(new URL('../../packages/power2d/generated-raw', import.meta.url)) },
      { find: '@avtools/power2d/core', replacement: fileURLToPath(new URL('../../packages/power2d/core/mod.ts', import.meta.url)) },
      { find: '@avtools/power2d/babylon', replacement: fileURLToPath(new URL('../../packages/power2d/babylon/mod.ts', import.meta.url)) },
      { find: '@avtools/power2d/raw', replacement: fileURLToPath(new URL('../../packages/power2d/raw/mod.ts', import.meta.url)) },
      { find: '@avtools/power2d', replacement: fileURLToPath(new URL('../../packages/power2d/mod.ts', import.meta.url)) },
      { find: '@avtools/codegen-common', replacement: fileURLToPath(new URL('../../packages/codegen-common/mod.ts', import.meta.url)) },
      { find: '@avtools/power2d-codegen', replacement: fileURLToPath(new URL('../../packages/power2d-codegen/mod.ts', import.meta.url)) },
      { find: '@avtools/compute-shader-codegen', replacement: fileURLToPath(new URL('../../packages/compute-shader-codegen/mod.ts', import.meta.url)) },
      { find: '@avtools/shader-fx-codegen', replacement: fileURLToPath(new URL('../../packages/shader-fx-codegen/mod.ts', import.meta.url)) },
      { find: '@avtools/compute-shader/generated', replacement: fileURLToPath(new URL('../../packages/compute-shader/generated', import.meta.url)) },
      { find: '@avtools/shader-fx/babylon', replacement: fileURLToPath(new URL('../../packages/shader-fx/babylon/mod.ts', import.meta.url)) },
      { find: '@avtools/shader-fx/babylonGL', replacement: fileURLToPath(new URL('../../packages/shader-fx/babylonGL/mod.ts', import.meta.url)) },
      { find: '@avtools/shader-fx/raw', replacement: fileURLToPath(new URL('../../packages/shader-fx/raw/mod.ts', import.meta.url)) },
      { find: '@avtools/shader-fx/generated', replacement: fileURLToPath(new URL('../../packages/shader-fx/generated', import.meta.url)) },
      { find: '@avtools/shader-fx', replacement: fileURLToPath(new URL('../../packages/shader-fx/mod.ts', import.meta.url)) },
    ],
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    process: '{}',
  },
  build: {
    target: 'esnext',
    outDir: '../../webcomponents/handwriting-canvas/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/canvas/web-component.ts', import.meta.url)),
      name: 'HandwritingCanvas',
      fileName: () => 'handwriting-canvas.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'handwriting-canvas.js',
        assetFileNames: 'handwriting-canvas.[ext]',
      },
    },
  },
})
