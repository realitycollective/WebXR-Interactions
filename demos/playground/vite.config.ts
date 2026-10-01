import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// The demo resolves the WORKSPACE libraries to source (the UI Extensions
// contributor model): no build step needed while iterating.
// @realitycollective/webxr-input is NOT aliased - it is published from its own
// repository and resolves from node_modules like any other dependency, as do
// the UI Extensions packages, so this build never depends on a sibling checkout.
//
// There is no UIKitML build step. `@iwsdk/vite-plugin-uikitml` was discontinued
// at 0.4.2, and it only ever did `JSON.stringify(parse(source))`. The panels are
// served as `.uikitml` source from public/ui and parsed in the browser.
export default defineConfig({
  resolve: {
    alias: {
      "@realitycollective/webxr-interactions": pkg("webxr-interactions"),
      "@realitycollective/threejs-interactions": pkg("threejs-interactions"),
      "@realitycollective/babylon-interactions": pkg("babylon-interactions"),
      "@realitycollective/iwsdk-interactions": pkg("iwsdk-interactions"),
      "@realitycollective/xrblocks-interactions": pkg("xrblocks-interactions"),
    },
  },
  server: { host: "0.0.0.0", port: 8082 },
  // xrblocks lazily imports optional integrations this demo never uses (see
  // build.rollupOptions.external). Excluding it from dependency pre-bundling
  // keeps those imports unevaluated instead of failing esbuild at dev start.
  optimizeDeps: { exclude: ["xrblocks"] },
  build: {
    outDir: "dist",
    target: "esnext",
    rollupOptions: {
      // xrblocks lazily imports optional integrations (AI, MediaPipe,
      // gaussian splats, text rendering). The playground uses none of them, so
      // they stay unresolved: xrblocks only touches them behind the matching
      // feature options. three-mesh-bvh is NOT external - @iwsdk/core imports
      // it for real.
      external: [
        "@google/genai",
        "openai",
        "@mediapipe/tasks-audio",
        "@mediapipe/tasks-vision",
        "@sparkjsdev/spark",
        "troika-three-text",
      ],
    },
  },
  esbuild: { target: "esnext" },
  base: "./",
});
