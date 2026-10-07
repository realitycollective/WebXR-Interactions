# Interaction playground

One scene, every platform. The same stations (push button, gaze dwell, table and wall levers, dial, pulley, a ball to throw at a hoop) register the same `InteractionDescriptor` and the same pointer display on IWSDK, three.js, Babylon and XR Blocks; the native host runs them through the Interactions harness (`harness/native`). A person plays every station on every platform and fills in the table under `WebXR/parity/playground/`.

```
npm run dev:playground
```

The launch screen pre-selects a platform from what the browser's WebXR runtime answers (`src/platform-choice.ts`): no immersive mode picks three.js with the mouse, a Meta Horizon OS browser picks IWSDK, `immersive-ar` anywhere else (Android XR, XREAL Aura) picks XR Blocks, and `immersive-vr` only picks three.js with its Enter VR button. The user agent only tells a Meta browser from any other. `?engine=iwsdk|threejs|xrblocks|babylon&autostart=1` skips the screen. The IWSDK build uses the documented app setup, `nativeGrab: true` included, so it stands for the web as apps ship it.

## Layout

- `src/scene.ts`: the portable data only. The descriptor, the pointer display (`PLAYGROUND_POINTER_DISPLAY`), every station part with its shape, pose and colours (`STATION_PARTS`), the panels and their copy.
- `src/stations-three.ts` and `src/stations-babylon.ts`: the two mesh builders over the same numbers.
- `src/platforms/*.ts`: one file per platform that creates the engine scene, builds the stations and creates the binding with the shared options. Nothing else.
- `src/client.ts`: the client pieces every platform shares: audio blips from feedback intents, haptics routed to the provider, the dwell ring, toss ballistics on platforms without physics, the score line, the Enter VR button and the trace recorder.
- `src/platform-choice.ts`: the launch screen's choice, from the WebXR runtime's answer.
- `src/diagnostics.ts` and `functions/api/report.ts`: the on-device log and the Pages Function that receives a sent one. Both are byte-identical to the UI Extensions lab's copies.
- `src/platforms/xrblocks-page.ts`: keeps XR Blocks' Enter XR button on screen and draws its 2D view from standing height, on a browser that can enter XR.

## Diagnostics

For framework testers only. A hidden URL option records what happens on the device and sends it to the maintainers; without it the playground records nothing and shows no Diagnostics button. `?log=1` records from the first line and sends the log by itself, 20 s after the page opens, when each XR session ends and when the page is left. `?log=local` keeps it on the device until the tester presses Send. Reports are kept at least 48 hours. Every pull request deploys the playground to `https://webxr-interactions-test.pages.dev`, the site to send testers; production picks the logging up with the next release.

If a log does not arrive, ask the tester to press **Diagnostics** at the bottom right, then **Download** (a `.txt` in the device's downloads; on Android XR, the Files app under Downloads; over USB, `adb pull /sdcard/Download/<file name>`) or **Copy**. With USB debugging, inspect the tab from `chrome://inspect/#devices` and run `copy(rcDiagnostics.text())`.

Storage needs a D1 database bound as `REPORTS_DB` on the `webxr-interactions` Pages project; until then the Function answers 503 and the log stays on the device. The setup, the commands that read reports, the retention and the limits are in the UI Extensions lab README (`demos/webxr-multiplatform/README.md` in WebXR-UIExtensions, "Diagnostics"); both labs can share one database.
## Recording a trace

Press Record (or R), choose the mechanic and the input, play it, press Stop: a `trace-<platform>-<mechanic>-<input>-<time>.json` downloads. A recording is run output, so keep it outside the repository. To replay recordings made on IWSDK on a Quest 3 through every binding, set `RC_TRACES_DIR` to their folder and run `iwsdk-interactions/test/trace-parity.test.ts`.

## Known limits

- Babylon has no UI Extensions binding, so its scene shows no description panels and shares no pointer arbiter with panels.
- The demo consumes the UI Extensions packages from npm. Until a preview with the `pointers` option is published (0.1.1-preview.3), the panel hosts ignore the shared arbiter here; the Interactions side already uses it.
- XR Blocks turns its own reticle off so only the binding's cursor shows.
