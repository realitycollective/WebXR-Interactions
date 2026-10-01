# Interaction playground

One scene, every platform. The same stations (push button, gaze dwell, table and wall levers, dial, pulley, a ball to throw at a hoop) register the same `InteractionDescriptor` and the same pointer display on IWSDK, three.js, Babylon and XR Blocks; the native host runs them through the Interactions harness (`harness/native`). A person plays every station on every platform and fills in the table under `WebXR/parity/playground/`.

```
npm run dev:playground
```

The launch screen detects the platform and pre-selects it; `?engine=iwsdk|threejs|xrblocks|babylon&autostart=1` skips it. The IWSDK build uses the documented app setup, `nativeGrab: true` included, so it stands for the web as apps ship it.

## Layout

- `src/scene.ts`: the portable data only. The descriptor, the pointer display (`PLAYGROUND_POINTER_DISPLAY`), every station part with its shape, pose and colours (`STATION_PARTS`), the panels and their copy.
- `src/stations-three.ts` and `src/stations-babylon.ts`: the two mesh builders over the same numbers.
- `src/platforms/*.ts`: one file per platform that creates the engine scene, builds the stations and creates the binding with the shared options. Nothing else.
- `src/client.ts`: the client pieces every platform shares: audio blips from feedback intents, haptics routed to the provider, the dwell ring, toss ballistics on platforms without physics, the score line, the Enter VR button and the trace recorder.

## Recording a trace

Press Record (or R), choose the mechanic and the input, play it, press Stop: a `trace-<platform>-<mechanic>-<input>-<time>.json` downloads. A recording is run output, so keep it outside the repository. To replay recordings made on IWSDK on a Quest 3 through every binding, set `RC_TRACES_DIR` to their folder and run `iwsdk-interactions/test/trace-parity.test.ts`.

## Known limits

- Babylon has no UI Extensions binding, so its scene shows no description panels and shares no pointer arbiter with panels.
- The demo consumes the UI Extensions packages from npm. Until a preview with the `pointers` option is published (0.1.1-preview.3), the panel hosts ignore the shared arbiter here; the Interactions side already uses it.
- XR Blocks turns its own reticle off so only the binding's cursor shows.
