import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// import vueJsx from '@vitejs/plugin-vue-jsx'
// import react from '@vitejs/plugin-react';
import ts from 'typescript';
import { vitePluginTypescriptTransform } from 'vite-plugin-typescript-transform';
import vueDevTools from 'vite-plugin-vue-devtools'
import { shaderCodegenPlugin } from '../../tools/vite-shader-plugin/index.ts'

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  plugins: [
    shaderCodegenPlugin({
      srcDir: 'src',
      outputDirOverrides: {
        'wgsl-material': '../../packages/power2d/generated',
        'wgsl-stroke-material': '../../packages/power2d/generated',
        'glsl-material': '../../packages/power2d/generated',
        'glsl-stroke-material': '../../packages/power2d/generated',
      },
    }),
    vue(), 
    // react(),
    // vueJsx()
    vitePluginTypescriptTransform({
      enforce: 'pre',
      filter: {
        files: {
          include: /\.ts$/,
        },
      },
      tsconfig: {
        location: fileURLToPath(new URL('./tsconfig.app.json', import.meta.url)),
        override: {
          target: ts.ScriptTarget.ES2021,
        },
      },
    }),
    vueDevTools()
  ],
  // build: {
  //   sourcemap: true,
  // },
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
    }
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))]
    }
  },
  build: {
    target: 'esnext',
    // sourcemap: true,
    minify: false, //enabling this breaks the faust wasm module
    rollupOptions: {
      output: {
        format: 'es', // Use ES module format
      },
    },
  },
  esbuild: {
    target: 'esnext', // Ensure esbuild doesn't transpile TLA
  },
})
