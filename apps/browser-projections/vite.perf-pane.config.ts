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
    },
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    process: '{}',
  },
  build: {
    target: 'esnext',
    outDir: '../../webcomponents/perf-pane/dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/perfPane/web-component.ts', import.meta.url)),
      name: 'PerfPaneComponent',
      fileName: () => 'perf-pane.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'perf-pane.js',
        assetFileNames: 'perf-pane.[ext]',
      },
    },
  },
})
