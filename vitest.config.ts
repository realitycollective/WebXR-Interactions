import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

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
  test: {
    globals: true,
    include: ["packages/*/test/**/*.test.ts", "demos/*/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      all: true,
      // EVERY package, not just the engine-free core. The adapters were
      // previously invisible here, which is how a desktop-input defect shipped
      // with nothing to catch it: the numbers looked healthy because the broken
      // file was not being measured.
      include: ["packages/*/src/**/*.ts"],
      // Files with NO executable code: pure `interface`/`type` declarations and
      // barrel re-exports. Types are erased before anything runs, so v8 scores
      // them 0% forever and they drag the totals down while hiding nothing.
      // Listed one by one rather than by a `**/index.ts` glob, so that an index
      // file that later grows real logic starts being measured instead of
      // silently staying exempt.
      exclude: [
        "packages/webxr-interactions/src/descriptor.ts",
        "packages/webxr-interactions/src/ports.ts",
        "packages/webxr-interactions/src/index.ts",
        "packages/threejs-interactions/src/index.ts",
        "packages/babylon-interactions/src/index.ts",
        "packages/iwsdk-interactions/src/index.ts",
        "packages/xrblocks-interactions/src/index.ts",
      ],
      // Anti-regression ratchets, one per package, each set to the floor that
      // package actually measures today. Per-package rather than one global
      // number on purpose - a single figure across the workspace would let the
      // well-tested core slide from 88% to the workspace average without
      // failing. Raise these as suites fill in, and never lower them.
      //
      // The house style (service-framework, WebXR-UIExtensions) gates at 100%
      // on the headlessly-testable modules. The core is close; the adapters are
      // a long way off, and the honest numbers are recorded here rather than
      // hidden by narrowing `include`.
      thresholds: {
        // Applies to any package added later that has no ratchet of its own.
        lines: 60,
        branches: 58,
        functions: 56,
        statements: 60,

        // The engine-free core. Closest to the house standard.
        "packages/webxr-interactions/src/**": {
          lines: 93,
          branches: 84,
          functions: 82,
          statements: 91,
        },
        // Desktop fallback, presence, hit-testing and the session sampling
        // path are covered. The host wiring is not.
        "packages/threejs-interactions/src/**": {
          lines: 79,
          branches: 68,
          functions: 70,
          statements: 77,
        },
        // Babylon has no package in this workspace, so the adapter is typed
        // against the shape of its API and the whole of it - provider, hit
        // tester, transform port and host - is reachable from structural
        // fakes. Nothing here needs a browser, so the floor is the house
        // standard rather than a task.
        "packages/babylon-interactions/src/**": {
          lines: 100,
          branches: 88,
          functions: 100,
          statements: 98,
        },
        // Provider covered, host is not.
        "packages/xrblocks-interactions/src/**": {
          lines: 69,
          branches: 80,
          functions: 55,
          statements: 70,
        },
        // Was 0/0/0/0 with no test file at all. The provider is now covered
        // headlessly (@iwsdk/core imports in node, so the tests use a
        // structural fake world and no module mocking). What is left below is
        // register.ts - the bridge system needs a real elics world - and the
        // transform port, so these numbers are still tasks, not targets.
        "packages/iwsdk-interactions/src/**": {
          lines: 52,
          branches: 52,
          functions: 55,
          statements: 53,
        },
      },
    },
  },
});
