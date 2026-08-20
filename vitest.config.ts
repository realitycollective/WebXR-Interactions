import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@realitycollective/webxr-interactions": pkg("webxr-interactions"),
      "@realitycollective/threejs-interactions": pkg("threejs-interactions"),
      "@realitycollective/iwsdk-interactions": pkg("iwsdk-interactions"),
      "@realitycollective/xrblocks-interactions": pkg("xrblocks-interactions"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/test/**/*.test.ts", "demos/*/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      all: true,
      include: ["packages/webxr-interactions/src/**/*.ts"],
      // Anti-regression ratchet, set to the current floor. The house style
      // (service-framework, WebXR-UIExtensions) gates the engine-free core at
      // 100% - raise these numbers as the behaviour suites fill in, and never
      // lower them.
      thresholds: {
        lines: 91,
        branches: 81,
        functions: 78,
        statements: 88,
      },
    },
  },
});
