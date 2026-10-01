# @realitycollective/webxr-interactions

The core of the Reality Collective Interaction Extensions. It holds all the interaction logic for WebXR and contains no 3D engine code at all.

Two words are used throughout. An **interactable** is an object that can be interacted with, such as a button. An **interactor** is the thing doing the interacting: a hand, controller, ray or mouse.

```sh
npm install @realitycollective/webxr-interactions
```

> You usually do **not** install this directly. Install an adapter for your engine instead. Each adapter re-exports everything here, so your app depends on one package: [`threejs-interactions`](https://www.npmjs.com/package/@realitycollective/threejs-interactions) · [`iwsdk-interactions`](https://www.npmjs.com/package/@realitycollective/iwsdk-interactions) · [`xrblocks-interactions`](https://www.npmjs.com/package/@realitycollective/xrblocks-interactions) · [`babylon-interactions`](https://www.npmjs.com/package/@realitycollective/babylon-interactions) · [`native-interactions`](https://www.npmjs.com/package/@realitycollective/native-interactions)

## What it provides

| Area | Detail |
| --- | --- |
| **Behaviours** | Ready-made interaction types: `press` (with an optional latching mode that stays down until pressed again), `pulse`, `hinge`, `dial`, `slide`, `grab`, and `tossScore` for throw-and-catch scoring |
| **Gaze** | Optional look-to-activate. Require the user to be looking before an object responds, or let a sustained look trigger the press by itself |
| **Eye gaze and pinch** | With a provider that reports `capabilities.eyeGaze`, the runtime targets the gaze source through a 5 degree cone (`HitTester.hitCone`) and a 0.15 s dwell consensus, targets nothing while a near pointer is active, presses or grabs on the owning hand's pinch, and drives a gaze-started drag from the hand (IWSDK 1.0.0 gaze-and-pinch, on every platform) |
| **Targeting** | Picks one target per hand, trying the platform's own answer first, then a close-range touch, then a pointing ray. A short delay stops the target flickering between two objects on a boundary |
| **Capability checks** | If the headset cannot do what a behaviour needs, the behaviour switches itself off and reports `behaviourDisabled`, rather than silently doing nothing |
| **Events** | The core never calls into your code. It emits events and you subscribe |
| **Feedback** | The core asks for a haptic pulse or a sound. Playing it is your app's job. `routeHapticsToProvider` is an opt-in helper that sends those requests straight to the controller |
| **Pointer arbitration** | One decision per hand across interactables and UI panels: pass a `PointerArbiter` from `@realitycollective/webxr-input` as `pointers` to this setup and to the UI Extensions host. `INTERACTIONS_POINTER_SET`, `NEAR_POINTER_DEFAULTS`, `nearPointerContractCases()` |
| **Pointer display** | The ray line and cursor disc as app configuration, IWSDK's look by default: the `pointerDisplay` option, `getPointerDisplay()`, `onPointerDrawing()`. Every binding draws the same drawing |
| **Physics** | `PhysicsFacility`, one contract for the platform physics behind grab, throw and rest, with IWSDK's defaults (`PHYSICS_DEFAULTS`) and `physicsFacilityContractCases()`. Every binding ships one: Rapier (three.js and XR Blocks), IWSDK's own, Babylon Physics V2, the native host's |
| **Held pose and throws** | `TransformPort.beginHold()` / `endHold(release)`: a grabbed object follows exactly while held and leaves with the object's own velocity over IWSDK's physics step (`ReleaseVelocityTracker`, `RELEASE_WINDOW_SECONDS`). `holderPoint` is the grip first, so hands drive a dial, slide or hinge as controllers do |
| **Recorded-trace parity** | `TraceRecorder`, `TraceInputProvider`, `replayTrace`, `compareOutcomes`, `traceParityCases()` and `TRACE_TOLERANCES`: an input session recorded on the reference replays through every binding with the same outcome. `synthesizeTrace` builds a synthetic one |
| **In-memory ports** | `MemoryHitTester`, `MemoryTransformPort` and `MemoryPhysicsFacility`: a complete engine-free host for tests, tools and the trace suite |
| **Conformance suites** | `hitTesterContractCases()`, `transformPortContractCases()`, `nearPointerContractCases()`, `physicsFacilityContractCases()`, plus `inputProviderContractCases()` from `@realitycollective/webxr-input`, shipped as data so any binding proves itself in its own test runner |
| **Platforms** | three.js (raw WebXR), Meta IWSDK (the reference), Google XR Blocks, Babylon.js and native hosts (OpenXR on Quest, visionOS). IWSDK is the reference behaviour; every other binding runs the same core rules |

All input arrives through the shared [`@realitycollective/webxr-input`](https://www.npmjs.com/package/@realitycollective/webxr-input) types, so the same core runs on any runtime that has an adapter.

## Design rules

- **No engine imports.** No `three`, no `@iwsdk/*`, no `xrblocks`. The adapter supplies the code that works out what a ray hits, and the code that moves an object.
- **Events out, never callbacks in.** The core never reaches into your objects.
- **Fail loudly, not silently.** A behaviour the hardware cannot support reports `behaviourDisabled` instead of quietly doing nothing.

## One pointer decision, and the pointer's look

Which pointer owns a hand (touch, grab or ray) is decided ONCE per source across interactables and UI panels, by the `PointerArbiter` from `@realitycollective/webxr-input` (IWSDK's `MultiPointer` over every pointer-event object). Pass one arbiter to the Interactions setup (`pointers`) and to the UI Extensions host, so a fingertip on a panel retires the ray over an object and the cursor is reported on panels too. What is drawn for a pointer is the app's `pointerDisplay` (`PointerDisplay`, IWSDK's look by default: the ray while hitting, drawn as a stub to 0.3 m; cursors on objects and panels), settable at run time; the runtime publishes `onPointerDrawing`, which every binding's renderer draws and the native host is handed.

Throws follow the object: the release velocity is the held object's velocity over IWSDK's physics step (`release-velocity.ts`). Parity with the web is measured by replaying recorded input traces (`trace.ts`) through every binding.

## Conformance suites

Every adapter implements `HitTester` and `TransformPort` (see `ports.ts`) against its own scene graph, so this package ships the checks as data rather than as tests: `hitTesterContractCases()` and `transformPortContractCases()`, alongside `inputProviderContractCases()` from [`@realitycollective/webxr-input`](https://www.npmjs.com/package/@realitycollective/webxr-input) for `InputProvider`. Each case throws a plain `Error` naming the rule a platform broke, so any test runner can host it - an adapter written outside this repository runs the same suite its own way. All three run against every platform in `packages/iwsdk-interactions/test/`, next to each other: `provider-parity.test.ts` for `InputProvider`, `port-parity.test.ts` for `HitTester` and `TransformPort`.

**Held pose.** `TransformPort` has two optional members for an object with a physics body: `beginHold()` suspends physics, and `endHold(release: HoldRelease)` resumes it with the hand's linear and angular velocity. While held, `setWorldPose` follows exactly and leaves velocities alone; while not held, it teleports and clears them. The `poseOnly` grab calls both. A port whose host has no physics implements neither and behaves as before; a platform that grabs natively must show the same held, released and reset behaviours through its own engine. `transformPortContractCases()` has three cases for this, which run when the subject has a `physics` driver and skip otherwise.

## Live demo

The interaction playground - the full station set on every platform (IWSDK, three.js, Babylon.js and XR Blocks), mouse-capable on desktop, VR button for headsets: **[webxr-interactions.pages.dev](https://webxr-interactions.pages.dev)**

## Documentation

Full architecture notes, the behaviour catalogue and the playground demo live in the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
