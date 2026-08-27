import { defineConfig } from "vite";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  base: "/__cloud/terminal/",
  build: {
    outDir: "../terminal-dist/__cloud/terminal",
    emptyOutDir: true,
  },
});
