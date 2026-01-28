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
      '@avtools/core-timing': fileURLToPath(new URL('../../packages/core-timing/mod.ts', import.meta.url)),
      '@avtools/creative-algs': fileURLToPath(new URL('../../packages/creative-algs/mod.ts', import.meta.url)),
      '@avtools/music-types': fileURLToPath(new URL('../../packages/music-types/mod.ts', import.meta.url)),
      '@avtools/ui-bridge': fileURLToPath(new URL('../../packages/ui-bridge/mod.ts', import.meta.url)),
      '@avtools/power2d': fileURLToPath(new URL('../../packages/power2d/mod.ts', import.meta.url)),
      '@avtools/power2d/core': fileURLToPath(new URL('../../packages/power2d/core/mod.ts', import.meta.url)),
      '@avtools/power2d/babylon': fileURLToPath(new URL('../../packages/power2d/babylon/mod.ts', import.meta.url)),
      '@avtools/power2d-codegen': fileURLToPath(new URL('../../packages/power2d-codegen/mod.ts', import.meta.url)),
      '@avtools/power2d/generated': fileURLToPath(new URL('../../packages/power2d/generated', import.meta.url))
    },
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
