# Native test harness (Interactions)

A native app built from this repository's own source that runs the Interactions family's suites against a real native host on the device, and plays the playground's stations there with the same registrations the web playground makes. It exists so a defect in a native host, or in the native binding, is found here before a client project runs into it.

The harness is a project for the WebXR-to-native conversion pipeline (the Reality Collective's `WebXR-Native-Pipeline` repository): `app.json` describes it, `entry.ts` is its native entry, `scene-assets.ts` and `scenes/` are its content. The pipeline bundles the entry to Hermes bytecode through its gates (no three.js or `@iwsdk` in the bundle, only the host-profile globals), cooks the station meshes to glTF, generates the Android project and builds the APK. Nothing in the pipeline names this project; it is handed this folder.

## Modes

The shell launches the app with `debug.rc.mode` set (`adb shell setprop debug.rc.mode kits`); a runner under Node sets `__rcShell.mode` before it loads the bundle.

| Mode | What runs | Where the result goes |
| --- | --- | --- |
| `kits` | `inputProviderContractCases`, `hitTesterContractCases`, `nearPointerContractCases`, `transformPortContractCases`, `physicsFacilityContractCases` and `nativeInteractionsHostConformanceCases`, against `__rcShell.testHost` on a device or the reference fakes under Node | one JSON line per suite (`step: "suite"`), then `step: "done"` with `pass` and every failure named |
| `play` | the playground stations registered over the live `__rcHost` with the playground's pointer display; a person plays them | one JSON line per interaction event, grab start and end, value change and throw release, and the drawing per source once a second |
| `trace` | `play` plus a `TraceRecorder`; `__rcShell.stopTrace()` writes the trace as JSON lines (`step: "trace"`, reassembled by the pipeline's log tools) | a trace to replay against the web's through `traceParityCases` |

`kits` is the default with no native host, `play` the default on a device.

## Building

CI compiles the harness and never runs it: a native build runs only on a developer's machine or a headset.

```
npm run harness:compile
```

That typechecks the harness, bundles `entry.ts` with esbuild (no browser, no engine, the host-profile gate) to `build/node/harness.js`, and compiles the bundle to Hermes bytecode with the flags the pipeline uses, so a bundle the device's engine would refuse fails the build. `--require-hermes` fails when `hermes-compiler` is missing instead of skipping that step; CI passes it.

With no `__rcHost` installed, the bundle uses this repository's reference fakes (`src/fakes.ts`), the same classes the package's own suites prove the kit against, so a local runner can load it in Node and drive `__rcTick` to prove the kits pass on the fakes.

For a device, the conversion pipeline builds the APK from `app.json` (`rc check`, `rc assets`, `rc build --target quest`). The pipeline takes each Reality Collective package from this repository's `node_modules` first, so the harness is built from this working tree once `npm run build` has run, and the rest from its own install. To build against other families' working trees as well, name their `packages/` folders in `RC_PACKAGES`. Nothing is copied over an install.

## What the shell must provide

The root contract (`__rcHost.onFrame`, `__rcTick`) and the `input`, `interactions` and `physics` slices of `@realitycollective/native-interactions` (`native-types.ts`). For `kits`, `__rcShell.testHost` with the same three slices over the shell's own test world and `readbacks.interactions` implementing `NativeInteractionsTestHost`: `placeTarget`, `placeScenery` (new on 29 September 2026: a shown mesh that is not an interactable, so the kit can prove the queries never answer with scenery), `clearTargets`, `presenceShown`, `lastRelease`, `cursors`, `pointerVisuals`, optionally `pointerDisplay` and `setTargetVisible`. A shell that keeps `placeScenery` on its `interactions` driver instead is bridged by `src/kits.ts`.

## Output

Everything the compile and the pipeline write goes under `build/`, which is ignored. Device logs and results are kept outside this repository.
