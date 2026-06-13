import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@avtools/piano-roll': fileURLToPath(
        new URL(
          '../../webcomponents/piano-roll/dist/piano-roll.js',
          import.meta.url,
        ),
      ),
    },
  },
})
