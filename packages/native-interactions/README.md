# @realitycollective/native-interactions

The native host adapter for the Reality Collective Interaction Extensions. A native app (OpenXR on Quest, CompositorServices on visionOS, or any other shell embedding a JavaScript engine such as Hermes) installs `globalThis.__rcHost`, and this package reads its `input` and `interactions` slices, and the optional `physics` slice, into the [`@realitycollective/webxr-interactions`](https://www.npmjs.com/package/@realitycollective/webxr-interactions) core.

```sh
npm install @realitycollective/native-interactions
```

It re-exports everything from the core, so this is the only interaction package your app needs.

## Tested on a headset

A native app built with this package passed on a Meta Quest 3 on 1 October 2026, played by a person and checked by its conformance kit.

Known issue on native: the grab interaction does not work as it should yet. Pinch works.

## What it binds

| Layer | Detail |
| --- | --- |
| **Input** | `__rcHost.input` - session facts (`getFacts`, `onFactsChanged`), sources (`sample`, `onSourcesChanged`), and optional head pose, hints, haptics and presence drawing (`applyPresence`). The provider derives the capabilities and decides presence itself, as the IWSDK provider does |
| **Hit-testing** | `__rcHost.interactions.hitRay` / `hitProximity` with IWSDK's semantics: the ray parameter to the closest point, and the distance to a target's SURFACE, clamped at zero. `setTargetRadius` tells the host each target's radius (0.1 m unless given) |
| **Movement** | `__rcHost.interactions`, keyed by the target id you chose when you registered the object with the native scene |
| **No engine dependency** | Assets and rendering stay in the native app; only numbers, strings, booleans and tuples cross the boundary |
| **Pointer drawing** | The host is handed the resolved drawing every frame (`applyPointerVisuals`) and the app's display settings (`applyPointerDisplay`); `createNativeInteractions({ pointers, pointerDisplay })` shares one arbiter with the UI binding |
| **Physics** | `NativePhysicsFacility` over the host's `physics` slice (the `physics` option): the host simulates, the binding decides held, released and rest as IWSDK does |
| **Eye gaze** | `getFacts().eyeTracking` and `getEyeGazePose()` on the input slice; the provider applies the shared gaze-and-pinch rule |
| **Proof on the device** | `nativeInteractionsHostConformanceCases()` (the kit, below) and the repository's native harness (`harness/native`), which the conversion pipeline builds into an app that runs every suite against the real host |

## Usage

One call, the same shape as `createBabylonInteractions` and `createThreeInteractions`:

```ts
import { createNativeInteractions } from "@realitycollective/native-interactions";

// Reads globalThis.__rcHost.input / .interactions when no slice is passed in,
// and drives update(dt) from the app's own frame callback, __rcHost.onFrame.
const interactions = createNativeInteractions({ attachToHost: true });

interactions.register({ id: "button", behaviours: [{ kind: "press" }] });
interactions.runtime.onEvent((event) => console.log(event.type));
```

The native app owns the scene, so an interactable is registered by id alone. The app answers hit queries and pose reads for that id through the `interactions` slice. Without `attachToHost`, call `interactions.update(dtSeconds)` from your own loop. `dispose()` detaches from the frame callback and disposes the runtime.

The provider, hit tester and transform port are exported too, as on every adapter, for an app that composes the runtime itself.

Pass the slices directly, typically in a test or when your host object is not on `globalThis`:

```ts
const provider = new NativeInputProvider({ input: myInputSlice });
const hitTester = new NativeHitTester({ interactions: myInteractionSlice });
const port = new NativeTransformPort("button", { interactions: myInteractionSlice });
```

A missing slice - neither passed in nor found on `globalThis.__rcHost` - throws one clear error naming it, at construction, rather than failing on the first call that needed it.

## Things to know

- **Copies, not references.** Every snapshot `sample()` returns, and every tuple inside it, is copied before it leaves `NativeInputProvider`, so a host that reuses its own sample buffers cannot change a snapshot your app is still holding. The same applies to hit results and to poses read through `NativeTransformPort`.
- **A host is handed results, not rules.** The host reports facts (`immersive`, `focused`, `handTracking`) and sources; `NativeInputProvider` derives every capability from them exactly as `IWSDKInputProvider.refreshCapabilities` does, re-derives on every facts or source change, and fires `onCapabilitiesChanged`. Presence is decided here too: the requested visibility per side and the modality, with `"auto"` showing hands while hand joints are live and controllers otherwise, handed to the host as `applyPresence(side, { hand, controller })`. Presence hides the MODELS only; the host never draws a hand ray and always draws a cursor disc at a ray's hit. No sources are sampled while the session lacks focus, and a pulse's intensity is clamped to 0..1, as on IWSDK.
- **Optional members are honest.** `getHeadPose`, `sampleHints`, `pulse`, `setPresenceVisible` and `setPresenceModality` on `NativeInputProvider`, and `setWorldPose`/`setEffect` on `NativeTransformPort`, are only ever present when the host slice itself carries the matching member - never a method that silently no-ops.
- **Held pose is required.** `beginHold(targetId)`/`endHold(targetId, release)` are required members of the `interactions` slice, and `NativeTransformPort` throws at construction without them. A pose-only grab calls both on every grab and release; a host that lacked them used to drop every release velocity silently. While held, the object follows `setWorldPose` writes exactly; on release, a target with a physics body resumes with `release`'s velocities so a throw carries through, and a target with no body rests where it was released, as on IWSDK. A `setWorldPose` while NOT held teleports and clears velocity. A native app that fulfils grabs itself (`nativeGrab: true`) implements both as no-ops and shows the same three behaviours (held, released, reset) through its own engine.
- **Haptics are routed by the app, as on IWSDK.** Press and grab feedback reach `pulse` when the app routes them, `routeHapticsToProvider((listener) => interactions.runtime.onFeedback(listener), interactions.provider)`, exactly as a web client does with `registerInteractions`. Neither setup routes them by itself.
- **One port per interactable.** `TransformPort` is per object; the native host is one object serving every registered interactable, so `NativeTransformPort` binds one `targetId` onto it, the same idea as an engine adapter's port binding to one scene node.
- **`NativeHit.targetId`** is renamed to the core's `interactableId` on the way through `NativeHitTester` - the native host names the thing it hit, the core names the thing it manages.

## What a host reports for a hand, and what it is handed to draw

`native-types.ts` states every input value a host reports, with its OpenXR source and resting value: a hand's `select` is the runtime's pinch gesture, 1 or 0, never a strength, and its `squeeze` is 0; a controller's are its trigger and grip values. Every hit query considers registered interactables only, never scenery, and a proximity hit's point is the surface point nearest the fingertip. The host is handed the resolved pointer drawing every frame (`applyPointerVisuals`: the ray stub's extent, radius and colour, the cursor's point, radius, opacity and offset, and which panel or object it sits on) and decides no display mode of its own. The native harness (`harness/native`) runs the whole kit on a device.

## Proving a host: the conformance kit

`nativeInteractionsHostConformanceCases()` returns the host cases, as runner-free data named `interactions/<row>` and `input/<row>`. A native app runs them on its device, inside a live focused session, against its real slices and the test readbacks of `NativeInteractionsTestHost` (`placeTarget`, `clearTargets`, `presenceShown`, `lastRelease`, `cursors`). They include the core's whole `hitTesterContractCases()` run against the host itself, so a host that measures proximity to a target's centre fails on the device, not in the field.

```ts
for (const hostCase of nativeInteractionsHostConformanceCases()) {
  await hostCase.run({ input: __rcHost.input, interactions: __rcHost.interactions, testHost: __rcShell.testHost });
}
```

## Peer dependency

None. No engine object crosses the boundary in either direction.

## Documentation

See the [repository README](https://github.com/realitycollective/WebXR-Interactions#readme).

## License

MIT - see [LICENSE](./LICENSE).
