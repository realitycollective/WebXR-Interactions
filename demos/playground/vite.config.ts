import { fileURLToPath } from "node:url";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vite";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// The demo resolves the WORKSPACE libraries to source (the UI Extensions
// contributor model): no build step needed while iterating.
// @realitycollective/webxr-input is NOT aliased - it is published from its own
// repository and resolves from node_modules like any other dependency, so this
// build never depends on a sibling checkout.
export default defineConfig({
  plugins: [compileUIKit({ sourceDir: "ui", outputDir: "public/ui" })],
  resolve: {
    alias: {
      "@realitycollective/webxr-interactions": pkg("webxr-interactions"),
      "@realitycollective/threejs-interactions": pkg("threejs-interactions"),
    },
  },
  server: { host: "0.0.0.0", port: 8082 },
  build: { outDir: "dist", target: "esnext" },
});
