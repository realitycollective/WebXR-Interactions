import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// The demo resolves the libraries to workspace SOURCE (the UI Extensions
// contributor model): no build step needed while iterating.
export default defineConfig({
  resolve: {
    alias: {
      "@realitycollective/webxr-input": fileURLToPath(
        new URL("../../../WebXR-Input/src/index.ts", import.meta.url),
      ),
      "@realitycollective/webxr-interactions": pkg("webxr-interactions"),
      "@realitycollective/threejs-interactions": pkg("threejs-interactions"),
    },
  },
  server: { host: "0.0.0.0", port: 8082 },
  build: { outDir: "dist", target: "esnext" },
});
