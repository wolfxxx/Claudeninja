import { defineConfig } from "vite";

// GitHub Pages serves the site at https://wolfxxx.github.io/ClaudeNinja/
// ARTIFACT=1 builds with relative URLs so the game can be hosted from any folder.
const pagesBase =
  process.env.ARTIFACT === "1" ? "./" : process.env.GITHUB_PAGES === "1" ? "/ClaudeNinja/" : "/";

export default defineConfig({
  base: pagesBase,
  // The local FBX village kit is a large junction under public/. Only the
  // playable web assets are copied after bundling (tools/copy-public.mjs).
  build: {
    copyPublicDir: false,
    target: "es2022",
    sourcemap: process.env.ARTIFACT !== "1",
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5173,
    open: true,
  },
  assetsInclude: ["**/*.glb"],
});
