import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The contracts package lives beside this workspace (own repo-to-be).
      "@realitycollective/webxr-input": fileURLToPath(
        new URL("../WebXR-Input/src/index.ts", import.meta.url),
      ),
      "@realitycollective/webxr-interactions": pkg("webxr-interactions"),
      "@realitycollective/threejs-interactions": pkg("threejs-interactions"),
      "@realitycollective/iwsdk-interactions": pkg("iwsdk-interactions"),
      "@realitycollective/xrblocks-interactions": pkg("xrblocks-interactions"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "demos/*/test/**/*.test.ts"],
    environment: "node",
  },
});
