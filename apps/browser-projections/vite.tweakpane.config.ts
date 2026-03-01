import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    outDir: '../../webcomponents/tweakpane/dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('../../webcomponents/tweakpane/src/tweakpane-client.ts', import.meta.url)),
      name: 'TweakpaneClient',
      fileName: () => 'tweakpane-client.js',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'tweakpane-client.js',
      },
    },
  },
})
