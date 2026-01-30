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
      exclude: ['wgsl-fragment', 'glsl-fragment'],
      outputDirOverrides: {
        'wgsl-material': '../../packages/power2d/generated',
        'wgsl-stroke-material': '../../packages/power2d/generated',
        'glsl-material': '../../packages/power2d/generated',
        'glsl-stroke-material': '../../packages/power2d/generated',
        'wgsl-compute': '../../packages/compute-shader/generated',
      },
    }),
    shaderCodegenPlugin({
      srcDir: 'src/rendering',
      include: ['wgsl-fragment', 'glsl-fragment'],
      outputDirOverrides: {
        'wgsl-fragment': '../../packages/shader-fx/generated',
        'glsl-fragment': '../../packages/shader-fx/generated',
      },
      shaderFxImportPathOverrides: {
        'wgsl-fragment': '@avtools/shader-fx/babylon',
        'glsl-fragment': '@avtools/shader-fx/babylonGL',
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
    ]
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
