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
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@agentcombine/core-timing': fileURLToPath(new URL('../../packages/core-timing/mod.ts', import.meta.url)),
      '@agentcombine/creative-algs': fileURLToPath(new URL('../../packages/creative-algs/mod.ts', import.meta.url)),
      '@agentcombine/music-types': fileURLToPath(new URL('../../packages/music-types/mod.ts', import.meta.url)),
      '@agentcombine/ui-bridge': fileURLToPath(new URL('../../packages/ui-bridge/mod.ts', import.meta.url)),
      '@agentcombine/power2d': fileURLToPath(new URL('../../packages/power2d/mod.ts', import.meta.url)),
      '@agentcombine/power2d/core': fileURLToPath(new URL('../../packages/power2d/core/mod.ts', import.meta.url)),
      '@agentcombine/power2d/babylon': fileURLToPath(new URL('../../packages/power2d/babylon/mod.ts', import.meta.url)),
      '@agentcombine/power2d-codegen': fileURLToPath(new URL('../../packages/power2d-codegen/mod.ts', import.meta.url)),
      '@agentcombine/power2d/generated': fileURLToPath(new URL('../../packages/power2d/generated', import.meta.url))
    },
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    process: '{}',
  },
  build: {
    target: 'esnext',
    outDir: '../../webcomponents/piano-roll/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/pianoRoll/web-component.ts', import.meta.url)),
      name: 'PianoRollComponent',
      fileName: () => 'piano-roll.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'piano-roll.js',
        assetFileNames: 'piano-roll.[ext]',
      },
    },
  },
})
