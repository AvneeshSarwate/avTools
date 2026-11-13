# Web Components

Standalone browser bundles used by Deno notebook iframes.

## Directory Structure

### Vue-based Web Components
**piano-roll**, **animation-editor**, **handwriting-canvas**

These are Vue components built as custom elements using Vite's lib mode with `@vitejs/plugin-vue` and `customElement: true`. Source code lives in `apps/browser-projections/src/`, and each component has a dedicated Vite config (e.g., `vite.piano-roll.config.ts`) that compiles it into a standalone IIFE bundle. Each subdirectory contains a `package.json` and built output in `dist/`.

### Pure TypeScript Web Component
**tweakpane**

A TypeScript wrapper around the tweakpane library for notebook usage. Source is in `webcomponents/tweakpane/src/tweakpane-client.ts`, built as an ES module via `apps/browser-projections/vite.tweakpane.config.ts`. Unlike the Vue components, this uses Vite's lib mode without the Vue plugin.
